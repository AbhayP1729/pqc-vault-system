import { AnimatePresence, motion } from 'framer-motion'

type Toast = {
  id: string
  title: string
  message: string
  tone: 'success' | 'error'
}

type ToastViewportProps = {
  toasts: Toast[]
  onDismiss: (id: string) => void
}

function getToastStyles(tone: Toast['tone']) {
  if (tone === 'success') {
    return 'border-emerald-200 bg-white text-gray-900 dark:border-emerald-900/60 dark:bg-[#111827] dark:text-gray-100'
  }

  return 'border-rose-200 bg-white text-gray-900 dark:border-rose-900/60 dark:bg-[#111827] dark:text-gray-100'
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className={`pointer-events-auto rounded-xl border p-4 shadow-lg ${getToastStyles(toast.tone)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{toast.title}</p>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-md p-1 text-gray-400 transition duration-200 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800 dark:hover:text-gray-300"
                aria-label="Dismiss notification"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m5 5 10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
