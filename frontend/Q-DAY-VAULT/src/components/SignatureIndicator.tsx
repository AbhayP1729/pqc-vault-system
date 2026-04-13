import type { SignatureState } from '../types'

type SignatureIndicatorProps = {
  state: SignatureState
}

function getIndicatorStyles(state: SignatureState) {
  if (state === 'verified') {
    return {
      dot: 'bg-emerald-500',
      label: 'Verified',
    }
  }

  if (state === 'failed') {
    return {
      dot: 'bg-rose-500',
      label: 'Failed',
    }
  }

  return {
    dot: 'bg-gray-400 dark:bg-gray-500',
    label: 'Pending',
  }
}

export function SignatureIndicator({ state }: SignatureIndicatorProps) {
  const indicator = getIndicatorStyles(state)

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm transition-colors duration-200 dark:border-gray-700 dark:bg-slate-800">
      <span className={`h-2.5 w-2.5 rounded-full ${indicator.dot}`} />
      <span className="text-gray-700 dark:text-gray-200">{indicator.label}</span>
    </div>
  )
}
