declare module 'react-vertical-timeline-component' {
  import { ReactNode } from 'react';

  export interface VerticalTimelineElementProps {
    className?: string;
    contentStyle?: React.CSSProperties;
    contentArrowStyle?: React.CSSProperties;
    date?: ReactNode;
    dateClassName?: string;
    icon?: ReactNode;
    iconStyle?: React.CSSProperties;
    children?: ReactNode;
    [key: string]: any;
  }

  export interface VerticalTimelineProps {
    className?: string;
    layout?: string;
    children?: ReactNode;
    [key: string]: any;
  }

  export const VerticalTimeline: React.FC<VerticalTimelineProps>;
  export const VerticalTimelineElement: React.FC<VerticalTimelineElementProps>;
}

