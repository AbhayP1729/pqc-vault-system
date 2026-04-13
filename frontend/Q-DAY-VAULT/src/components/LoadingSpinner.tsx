type LoadingSpinnerProps = {
  className?: string
}

export function LoadingSpinner({ className = 'h-4 w-4' }: LoadingSpinnerProps) {
  return (
    <span
      className={`${className} inline-block animate-spin rounded-full border-2 border-current border-r-transparent`}
      aria-hidden="true"
    />
  )
}
