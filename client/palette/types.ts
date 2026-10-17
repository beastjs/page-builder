export const paletteTabs = ['All', 'Pages', 'Components', 'Sections', 'Navs', 'Tabs'] as const
export type PaletteTab = typeof paletteTabs[number]

export interface PaletteAction {
  id: string
  name: string
  detail: string
  icon: string
  group: string
  run: () => void
}

export interface PaletteProps {
  actions: PaletteAction[]
  tab: PaletteTab
  query: string
  selected: number
  dark: boolean
  projectName: string
  message: string
  onQueryChange: (query: string) => void
  onTabChange: (tab: PaletteTab) => void
  onSelect: (index: number) => void
  onCreate: () => void
  onClose: () => void
}
