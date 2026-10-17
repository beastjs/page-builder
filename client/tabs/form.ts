import { useForm } from '@octanejs/tanstack-form'
import type { TabsDraft } from '../../shared/types.js'

export function useTabsForm(draft: TabsDraft, onChange: (draft: TabsDraft) => void, onReview: () => Promise<void>) {
  return useForm({
    defaultValues: draft,
    listeners: { onChange: ({ formApi }) => onChange(formApi.state.values) },
    onSubmit: async ({ value }) => {
      onChange(value)
      await onReview()
    }
  })
}

export type TabsForm = ReturnType<typeof useTabsForm>
