import type { InputHTMLAttributes } from 'react';
import { hmWord } from '../lib/constants';
import { cx } from './ui';

/**
 * A time field that always reads 12-hour ("7:30 PM" / «7:30 م»), whatever the phone's clock setting: the time is
 * written as text, and the phone's own time field sits on top of it, invisible, so a tap still opens its wheel.
 * Takes the same props as <input type="time"> (value "HH:mm").
 */
export function TimeField({ className, value, dir: _dir, ...rest }: InputHTMLAttributes<HTMLInputElement> & { value: string }) {
  return (
    <span className={cx(className, 'relative !flex items-center')}>
      <span className="num pointer-events-none block w-full" dir="ltr">{hmWord(value)}</span>
      <input {...rest} type="time" value={value} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
    </span>
  );
}
