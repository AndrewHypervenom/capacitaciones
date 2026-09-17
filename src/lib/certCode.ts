/**
 * El código que se IMPRIME en el diploma y se muestra en pantalla.
 *
 * Antes se recortaba a 16 caracteres, y los códigos reales tienen 19
 * (`LAI-20260916-48350B`): se perdía la mitad de la parte aleatoria. Con la
 * fecha a la vista quedaban unas 4.000 combinaciones por día, fáciles de
 * probar, y dos diplomas del mismo día podían compartir código impreso y no
 * validarse. Ahora va completo; el tope solo frena identificadores de relleno
 * largos (p. ej. la vista previa) que romperían el diseño.
 */
export function printableCertCode(id: string): string {
  return id.slice(0, 24).toUpperCase()
}
