import type { LucideIcon } from 'lucide-react'

/**
 * What a list says when it has nothing in it.
 *
 * Every page had written its own, so the icon size, the padding and the two text
 * colours differed depending on which empty list you happened to hit — and the
 * heading was drawn in the same colour as the explanation under it.
 */
export default function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon?: LucideIcon
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center py-20">
      {Icon && <Icon size={40} className="mx-auto mb-4 text-ink-faint" aria-hidden="true" />}
      <p className="text-lg font-medium text-ink-secondary">{title}</p>
      {hint && <p className="text-sm text-ink-tertiary mt-1.5">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  )
}
