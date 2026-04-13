import { motion } from 'framer-motion'

import type { Theme } from '../types'

type ThemeToggleProps = {
  theme: Theme
  onToggle: () => void
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77M18.54 18.54l-1.77-1.77M7.23 7.23 5.46 5.46" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M20 15.26A8 8 0 1 1 8.74 4 6.5 6.5 0 0 0 20 15.26Z" />
    </svg>
  )
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      whileTap={{ scale: 0.98 }}
      className="relative inline-flex h-10 w-[74px] items-center rounded-full border border-gray-200 bg-white px-1 shadow-sm transition duration-200 dark:border-gray-700 dark:bg-[#111827]"
      aria-label="Toggle theme"
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className={`absolute h-8 w-8 rounded-full bg-gray-900 dark:bg-cyan-400 ${
          theme === 'dark' ? 'translate-x-8' : 'translate-x-0'
        }`}
      />
      <span className="relative z-10 flex w-full items-center justify-between px-2 text-gray-500 dark:text-gray-300">
        <SunIcon />
        <MoonIcon />
      </span>
    </motion.button>
  )
}
