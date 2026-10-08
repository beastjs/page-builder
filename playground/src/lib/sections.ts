export interface WorkspaceTab {
  value: 'ideas' | 'activity'
  label: string
  disabled?: boolean
}

export const workspaceTabs: WorkspaceTab[] = [
  { value: 'ideas', label: 'Starting points' },
  { value: 'activity', label: 'Recent activity' },
]
