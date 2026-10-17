import type { DetectedCollection, ProjectFile, TabInstance } from '../../shared/types.js'

interface InspectorControls {
  dark: boolean
  onBack: () => void
  onClose: () => void
}

export interface FileInspectorProps extends InspectorControls {
  file: ProjectFile
  source: string
  instances: TabInstance[]
  message: string
  onCopy: () => Promise<void>
  onEditPage: () => void
  onEditTabs: (instance: TabInstance) => void
}

export interface CollectionInspectorProps extends InspectorControls {
  collection: DetectedCollection
}
