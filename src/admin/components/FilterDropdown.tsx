// FilterDropdown se mantiene como alias del componente Select unificado del sitio
// (src/components/ui/Select.tsx) para no romper importaciones existentes. Toda la
// lógica vive en Select; aquí solo re-exportamos con el nombre histórico.
import { Select, type SelectOption, type SelectProps } from '@/components/ui/Select'

export type FilterDropdownOption = SelectOption
export type FilterDropdownProps = SelectProps

export function FilterDropdown(props: FilterDropdownProps) {
  return <Select {...props} />
}

export default FilterDropdown
