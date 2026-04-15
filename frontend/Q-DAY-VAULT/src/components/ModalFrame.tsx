import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'

import type { ReactNode } from 'react'

type ModalFrameProps = {
  isOpen: boolean
  title?: string
  description?: string
  onClose: () => void
  children: ReactNode
  panelClassName?: string
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function ModalFrame({
  isOpen,
  title,
  description,
  onClose,
  children,
  panelClassName = 'max-w-2xl',
}: ModalFrameProps) {
  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeydown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 px-4 py-8 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={`relative max-h-[90vh] w-full overflow-y-auto rounded-[28px] border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-900 ${panelClassName}`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition duration-200 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100"
              aria-label="Close modal"
            >
              <CloseIcon />
            </button>

            {title ? (
              <div className="pr-12">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
                {description ? (
                  <p className="mt-2 text-base text-gray-600 dark:text-gray-400">{description}</p>
                ) : null}
              </div>
            ) : null}

            <div className={title ? 'mt-6' : ''}>{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
