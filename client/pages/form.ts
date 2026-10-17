import { useForm } from '@octanejs/tanstack-form'
import type { PageDraft } from '../../shared/types.js'

export function usePageForm(draft: PageDraft, onChange: (draft: PageDraft) => void, onReview: () => Promise<void>) {
  return useForm({
    defaultValues: draft,
    listeners: { onChange: ({ formApi }) => onChange(formApi.state.values) },
    onSubmit: async ({ value }) => {
      onChange(value)
      await onReview()
    }
  })
}
