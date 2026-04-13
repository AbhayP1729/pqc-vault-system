const steps = ['Proposed', 'Signed', 'Approved', 'Executed']

type ExecutionTimelineProps = {
  currentStep: number
}

export function ExecutionTimeline({ currentStep }: ExecutionTimelineProps) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[440px]">
        <div className="relative mt-4">
          <div className="absolute left-0 right-0 top-4 h-px bg-gray-200 dark:bg-gray-700" />
          <div className="relative grid grid-cols-4 gap-4">
            {steps.map((step, index) => {
              const isComplete = index < currentStep
              const isCurrent = index === currentStep

              return (
                <div key={step} className="flex flex-col items-center text-center">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 ${
                      isComplete || isCurrent
                        ? 'border-blue-600 bg-blue-600 text-white dark:border-cyan-400 dark:bg-cyan-400 dark:text-slate-950'
                        : 'border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-[#111827] dark:text-gray-400'
                    }`}
                  >
                    {index + 1}
                  </div>
                  <p className="mt-3 text-xs font-medium text-gray-600 dark:text-gray-300">{step}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
