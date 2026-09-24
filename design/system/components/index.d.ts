import type * as React from 'react';

/** Why an item is on your day. The shape carries the meaning; colour only adds lateness. */
export type ReasonKind = 'promise' | 'reply' | 'meeting' | 'quiet' | 'renewal';

export interface ReasonMarkProps { kind: ReasonKind; late?: boolean; /** Accessible name; defaults to the reason in words. Pass "" when a visible word sits beside it. */ label?: string; className?: string }
export declare function ReasonMark(props: ReasonMarkProps): React.ReactElement;

export interface KeyProps { children: React.ReactNode; className?: string }
export declare function Key(props: KeyProps): React.ReactElement;

export interface KeyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { /** The shortcut shown on the cap: "E", "S", "↵". */ keyLabel?: string; /** At most one per pane: the action the pane exists for. */ primary?: boolean }
export declare function KeyButton(props: KeyButtonProps): React.ReactElement;

export interface SegmentedProps { options: { value: string; label: string }[]; value: string; onChange?: (value: string) => void; label?: string; className?: string }
export declare function Segmented(props: SegmentedProps): React.ReactElement;

export interface GroupHeaderProps { label: string; count?: number; late?: boolean; className?: string }
export declare function GroupHeader(props: GroupHeaderProps): React.ReactElement;

export interface QueueRowProps { kind: ReasonKind; who: string; what: string; /** "3d late", "14:00", "9d", "in 14d". */ age: string; late?: boolean; selected?: boolean; /** Sitting with the other side: shown, never selectable. */ waiting?: boolean; onSelect?: () => void; className?: string }
export declare function QueueRow(props: QueueRowProps): React.ReactElement;

export interface EyebrowProps { kind?: ReasonKind; late?: boolean; children: React.ReactNode; className?: string }
export declare function Eyebrow(props: EyebrowProps): React.ReactElement;

export interface WhyBlockProps { /** The fact that matters, set bold: "Due 3 days ago." */ reason: string; /** The context after it. */ detail?: string; /** Other promises folded into this action. */ also?: string; late?: boolean; className?: string }
export declare function WhyBlock(props: WhyBlockProps): React.ReactElement;

export interface Fact { label: string; value: React.ReactNode; /** Mono, for money and counts. */ figure?: boolean; late?: boolean }
export interface FactStripProps { facts: Fact[]; /** Equal columns instead of content-width. */ fill?: boolean; className?: string }
export declare function FactStrip(props: FactStripProps): React.ReactElement;

export type ContactKind = 'call' | 'email' | 'meeting' | 'note';
export interface ContactHeatProps { /** One entry per day, oldest first; null for no contact. */ cells: (null | ContactKind | { type: ContactKind; title?: string })[]; summary?: React.ReactNode; summaryText?: string; className?: string }
export declare function ContactHeat(props: ContactHeatProps): React.ReactElement;

export interface LogEntry { date: string; type: string; who: string; you?: boolean; note: string }
export interface LogTableProps { entries: LogEntry[]; empty?: string; className?: string }
export declare function LogTable(props: LogTableProps): React.ReactElement;

export interface PromiseItemProps { what: string; due: string; late?: boolean; done?: boolean; onToggle?: () => void; className?: string }
export declare function PromiseItem(props: PromiseItemProps): React.ReactElement;

export interface LogInputProps { onLog?: (text: string) => void; placeholder?: string; action?: string; id?: string; className?: string }
export declare function LogInput(props: LogInputProps): React.ReactElement;

export interface BoxProps { title?: string; children?: React.ReactNode; className?: string }
export declare function Box(props: BoxProps): React.ReactElement;

export interface TopBarProps { /** Screens, in order; one is current. A count shows what is due on that screen, in late. */ nav?: { label: string; href: string; current?: boolean; count?: number }[]; where?: React.ReactNode; /** The signed-in person; renders the initials button at the far right. */ me?: { name: string; initials: string }; onMe?: () => void; children?: React.ReactNode; className?: string }
export declare function TopBar(props: TopBarProps): React.ReactElement;

export interface KeyLegendProps { keys: { key: string | string[]; label: string }[]; done?: number; total?: number; className?: string }
export declare function KeyLegend(props: KeyLegendProps): React.ReactElement;

export interface EmptyStateProps { title?: string; children?: React.ReactNode; rules?: { kind: ReasonKind; title: string; text: string }[]; actions?: React.ReactNode; className?: string }
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface ToastProps { children: React.ReactNode; onUndo?: () => void; className?: string }
export declare function Toast(props: ToastProps): React.ReactElement;

declare global {
  interface Window {
    Halden: {
      ReasonMark: typeof ReasonMark; Key: typeof Key; KeyButton: typeof KeyButton; Segmented: typeof Segmented;
      GroupHeader: typeof GroupHeader; QueueRow: typeof QueueRow; Eyebrow: typeof Eyebrow; WhyBlock: typeof WhyBlock;
      FactStrip: typeof FactStrip; ContactHeat: typeof ContactHeat; LogTable: typeof LogTable; PromiseItem: typeof PromiseItem;
      LogInput: typeof LogInput; Box: typeof Box; TopBar: typeof TopBar; KeyLegend: typeof KeyLegend;
      EmptyState: typeof EmptyState; Toast: typeof Toast;
    };
  }
}
