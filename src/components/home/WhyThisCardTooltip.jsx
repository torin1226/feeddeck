const KIND_TONE = {
  creator: 'bg-accent/15 border-accent/30 text-accent',
  subscription: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
  tag: 'bg-sky-500/15 border-sky-400/30 text-sky-300',
  topic: 'bg-violet-500/15 border-violet-400/30 text-violet-300',
}

export default function WhyThisCardTooltip({ reason }) {
  if (!reason) return null
  const tone = KIND_TONE[reason.kind] || KIND_TONE.topic
  return (
    <div
      role="tooltip"
      className={`absolute top-2 left-2 z-20 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide
        border backdrop-blur-md transition-opacity duration-200 max-w-[80%] truncate
        ${tone}`}
    >
      {reason.label}
    </div>
  )
}
