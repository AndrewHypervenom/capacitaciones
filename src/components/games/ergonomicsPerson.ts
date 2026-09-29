import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { ErgoSetup } from './ergonomicsModel'

const v = (x=0,y=0,z=0) => new T.Vector3(x,y,z)
const Z=v(0,0,1)
type Rest = { position:T.Vector3; rotation:T.Quaternion; world:T.Vector3; worldRotation:T.Quaternion }
export type HumanPose = { setup:ErgoSetup; step:number; time:number; reduced:boolean }

/** Microsoft Rocketbox mesh and skin weights; joints deform a continuous body. */
export function createErgoPerson(scene:T.Scene, onReady:()=>void, onError:()=>void) {
  let model:T.Group|undefined, alive=true
  const bones=new Map<string,T.Object3D>(), rest=new Map<string,Rest>()
  const eye=v(), shoulder=v()
  const materialTime={value:0}
  function release(root:T.Object3D) {
    const materials=new Set<T.Material>(), textures=new Set<T.Texture>(), geometries=new Set<T.BufferGeometry>(), skeletons=new Set<T.Skeleton>()
    root.traverse(o=>{
      if(o instanceof T.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m))}
      if(o instanceof T.SkinnedMesh)skeletons.add(o.skeleton)
    })
    materials.forEach(m=>{for(const value of Object.values(m))if(value instanceof T.Texture)textures.add(value);m.dispose()})
    textures.forEach(t=>{t.dispose();if(typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap)t.image.close()});geometries.forEach(g=>g.dispose());skeletons.forEach(s=>s.dispose())
  }
  const ready=new GLTFLoader().loadAsync('/ergonomics/office-human.glb?v=business-female-04').then(gltf=>{
    if(!alive){release(gltf.scene);return}
    model=gltf.scene;scene.add(model);model.updateMatrixWorld(true)
    model.traverse(o=>{
      if(o instanceof T.Bone || o.name === 'Bip01'){bones.set(o.name,o);rest.set(o.name,{position:o.position.clone(),rotation:o.quaternion.clone(),world:o.getWorldPosition(v()),worldRotation:o.getWorldQuaternion(new T.Quaternion())})}
      if(o instanceof T.Mesh){
        o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false
        const materials=Array.isArray(o.material)?o.material:[o.material]
        for(const m of materials)if(m instanceof T.MeshStandardMaterial){
          if(m.map)m.map.anisotropy=4
          if(m.name.endsWith('_opacity')) {
            m.side=T.DoubleSide;m.alphaTest=.28;m.roughness=.88
            // Millimetric motion of transparent hair cards, not a solid scalp cap.
            m.onBeforeCompile=shader=>{shader.uniforms.hairTime=materialTime;shader.vertexShader='uniform float hairTime;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <skinning_vertex>','#include <skinning_vertex>\ntransformed.x += sin(hairTime * 1.3 + position.z * 0.3) * 0.07;')}
            m.customProgramCacheKey=()=> 'ergo-hair-cards-v1'
          }
        }
      }
    })
    onReady()
  }).catch(()=>{if(alive)onError()})
  function bone(name:string){return bones.get('Bip01'+(name?'_'+name:''))!}
  function original(name:string){return rest.get('Bip01'+(name?'_'+name:''))!}
  function worldRotation(name:string,position:T.Vector3,rotation:T.Quaternion) {
    const b=bone(name);b.parent!.updateWorldMatrix(true,false)
    b.position.copy(b.parent!.worldToLocal(position.clone()))
    b.quaternion.copy(b.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation))
    b.updateMatrixWorld(true)
  }
  function orient(name:string,child:string,start:T.Vector3,end:T.Vector3) {
    const from=original(child).world.clone().sub(original(name).world).normalize()
    const to=end.clone().sub(start).normalize()
    worldRotation(name,start,new T.Quaternion().setFromUnitVectors(from,to).multiply(original(name).worldRotation))
  }
  function elbow(a:T.Vector3,c:T.Vector3,l1:number,l2:number,bend:T.Vector3) {
    const delta=c.clone().sub(a), distance=T.MathUtils.clamp(delta.length(),.001,l1+l2-.002), axis=delta.normalize()
    c.copy(a).addScaledVector(axis,distance)
    const projection=(l1*l1-l2*l2+distance*distance)/(2*distance)
    const height=Math.sqrt(Math.max(0,l1*l1-projection*projection))
    const normal=bend.clone().addScaledVector(axis,-bend.dot(axis)).normalize()
    return a.clone().addScaledVector(axis,projection).addScaledVector(normal,height)
  }
  function handRotation(side:'L'|'R',wrist:T.Vector3,forward:T.Vector3) {
    const r=original(side+'_Hand'), direction=original(side+'_Finger2').world.clone().sub(r.world).normalize()
    const across=original(side+'_Finger4').world.clone().sub(original(side+'_Finger1').world)
    across.addScaledVector(direction,-across.dot(direction)).normalize()
    const normal=direction.clone().cross(across).normalize()
    const basis=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(across,normal,direction))
    const desiredAcross=v(side==='L'?1:-1,0,0).addScaledVector(forward,-forward.x*(side==='L'?1:-1)).normalize()
    const desiredNormal=forward.clone().cross(desiredAcross).normalize()
    const desired=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(desiredAcross,desiredNormal,forward))
    worldRotation(side+'_Hand',wrist,desired.multiply(basis.invert()).multiply(r.worldRotation))
  }
  function update({setup:s,step,time,reduced}:HumanPose) {
    if(!model)return null
    materialTime.value=reduced?0:performance.now()/1000
    for(const [name,b]of bones){const r=rest.get(name)!;b.position.copy(r.position);b.quaternion.copy(r.rotation)}
    model.updateMatrixWorld(true)
    const stand=step===2, active=step>=0, wave=reduced?0:Math.sin(time*2)
    const seat=.6+(s.seat-47)*.012, hip=v(stand?.92:0,stand?.925:seat+.11,-.48)
    const lean=stand?0:(s.back-90)*Math.PI/180, up=v(0,Math.cos(lean),-Math.sin(lean))
    const torso=(height:number)=>hip.clone().addScaledVector(up,height)
    worldRotation('',hip,original('').worldRotation)
    worldRotation('Pelvis',hip,original('Pelvis').worldRotation)
    orient('Spine','Spine1',torso(.12),torso(.245))
    orient('Spine1','Spine2',torso(.245),torso(.367))
    orient('Spine2','Neck',torso(.367),torso(.533))
    const shrug=step===0?.018*(wave+1):0
    // Head and neck stay still in every movement; only the shoulders rise.
    const neck=torso(.533), head=neck.clone().add(v(0,.069,s.back<90?.03:0))
    orient('Neck','Head',neck,head)
    const headQ=new T.Quaternion().setFromEuler(new T.Euler(s.back<90?.12:0,0,0)).multiply(original('Head').worldRotation)
    worldRotation('Head',head,headQ)
    for(const side of ['L','R'] as const){
      const sign=side==='L'?1:-1
      const arm=torso(.46).add(v(sign*.177,shrug,-.03))
      const clavicle=torso(.484).add(v(sign*.077,shrug,-.015))
      orient(side+'_Clavicle',side+'_UpperArm',clavicle,arm)
      // Break poses keep the hands clear of the desk: raised in front of the chest for the
      // hand mobility step, resting on the thighs while seated, hanging when standing.
      const wrist=!active?v(sign*.16,.995,-.32+s.reach*.008):step===1?arm.clone().add(v(sign*.06,-.05,.22)):stand?arm.clone().add(v(sign*.015,-.47,.025)):v(sign*.15,hip.y+.1,-.3)
      if(stand)wrist.z+=wave*.05*sign
      const bend=elbow(arm,wrist,.254,.240,v(sign*.12,-1,-.2))
      orient(side+'_UpperArm',side+'_Forearm',arm,bend)
      orient(side+'_Forearm',side+'_Hand',bend,wrist)
      handRotation(side,wrist,wrist.clone().sub(bend).normalize())
      if(step===1)for(let finger=1;finger<=4;finger++)for(const suffix of ['', '1','2']){
        const b=bone(side+'_Finger'+finger+suffix)
        b.quaternion.multiply(new T.Quaternion().setFromAxisAngle(Z,(wave+1)*.38))
      }
      const thigh=hip.clone().add(v(sign*.095,0,0))
      const ankle=stand?v(hip.x+sign*.11,.10+Math.max(0,wave*sign)*.022,-.48+wave*.06*sign):v(sign*.11,s.feet?.235:Math.max(.11,hip.y-.48),-.03)
      const knee=elbow(thigh,ankle,.427,.400,Z)
      orient(side+'_Thigh',side+'_Calf',thigh,knee)
      orient(side+'_Calf',side+'_Foot',knee,ankle)
      worldRotation(side+'_Foot',ankle,original(side+'_Foot').worldRotation)
    }
    model.updateMatrixWorld(true)
    const blink=reduced?0:Math.max(0,1-Math.abs((time%5.3)-4.8)/.08)
    for(const side of ['L','R']){
      const b=bone(side+'EyeBlinkTop');b.position.addScaledVector(v(0,0,1),blink*.12)
    }
    eye.copy(bone('LEye').getWorldPosition(v())).add(bone('REye').getWorldPosition(v())).multiplyScalar(.5)
    shoulder.copy(bone('L_UpperArm').getWorldPosition(v())).add(bone('R_UpperArm').getWorldPosition(v())).multiplyScalar(.5)
    return {eye,shoulder}
  }
  return {ready,update,dispose(){alive=false;if(model){scene.remove(model);release(model);model=undefined}}}
}
