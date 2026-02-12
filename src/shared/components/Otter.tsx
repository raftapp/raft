interface OtterProps {
  className?: string
  variant?: 'default' | 'sleeping'
}

function OtterDefault({ className }: { className?: string }) {
  return (
    <img
      src="/mascot/awake-together.png"
      alt="Otter mascot"
      class={`object-contain ${className ?? ''}`}
      draggable={false}
    />
  )
}

function OtterSleeping({ className }: { className?: string }) {
  return (
    <img
      src="/mascot/sleeping-together.png"
      alt="Sleeping otter mascot"
      class={`object-contain ${className ?? ''}`}
      draggable={false}
    />
  )
}

export function Otter({ className, variant = 'default' }: OtterProps) {
  if (variant === 'sleeping') {
    return <OtterSleeping className={className} />
  }
  return <OtterDefault className={className} />
}
