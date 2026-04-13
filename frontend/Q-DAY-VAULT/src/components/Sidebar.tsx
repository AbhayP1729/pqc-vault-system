import { motion } from 'framer-motion'

import type { NavItem } from '../types'

type SidebarProps = {
  items: NavItem[]
  activeItem: NavItem
  onSelect: (item: NavItem) => void
}

function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`h-3 w-3 rounded-full transition duration-200 ${
        active
          ? 'scale-110 bg-blue-600 dark:bg-cyan-400'
          : 'bg-gray-300 dark:bg-gray-600'
      }`}
    />
  )
}

export function Sidebar({ items, activeItem, onSelect }: SidebarProps) {
  return (
    <motion.aside
      initial={{ x: -16, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
      className="group/sidebar sticky top-0 hidden h-screen w-20 flex-col border-r border-gray-200 bg-white px-3 py-5 transition-[width] duration-200 hover:w-52 dark:border-gray-700 dark:bg-gray-900 lg:flex"
    >
      <div className="px-2">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 rounded-full bg-blue-600 dark:bg-cyan-400" />
          <div className="overflow-hidden transition duration-200 group-hover/sidebar:opacity-100 opacity-0">
            <p className="whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">PQC Vault</p>
            <p className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">Navigation</p>
          </div>
        </div>
      </div>

      <nav className="mt-10 space-y-2">
        {items.map((item) => {
          const isActive = item === activeItem

          return (
            <button
              key={item}
              type="button"
              title={item}
              onClick={() => onSelect(item)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition duration-200 ${
                isActive
                  ? 'bg-blue-50 text-blue-700 dark:bg-cyan-400/10 dark:text-cyan-300'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100'
              }`}
            >
              <Dot active={isActive} />
              <span className="overflow-hidden whitespace-nowrap opacity-0 transition duration-200 group-hover/sidebar:opacity-100">
                {item}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto px-2">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 transition duration-200 dark:border-gray-700 dark:bg-slate-800/80 dark:text-gray-400">
          <p className="opacity-0 transition duration-200 group-hover/sidebar:opacity-100">
            Hover to expand the sidebar and switch between dashboard views.
          </p>
        </div>
      </div>
    </motion.aside>
  )
}
