import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }

export const UndoIcon = (props: IconProps) => <svg {...base} {...props}><path d="M9 7 4 12l5 5" /><path d="M5 12h8a6 6 0 0 1 6 6" /></svg>
export const PassIcon = (props: IconProps) => <svg {...base} {...props}><path d="M5 12h14M14 7l5 5-5 5" /></svg>
export const SparkIcon = (props: IconProps) => <svg {...base} {...props}><path d="m12 3 1.4 4.1L17 9l-3.6 1.9L12 15l-1.4-4.1L7 9l3.6-1.9L12 3Z" /><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Zm14-3 .7 2.3L22 14l-2.3.7L19 17l-.7-2.3L16 14l2.3-.7L19 11Z" /></svg>
export const NewIcon = (props: IconProps) => <svg {...base} {...props}><path d="M12 5v14M5 12h14" /></svg>
export const InfoIcon = (props: IconProps) => <svg {...base} {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></svg>
