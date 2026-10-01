import { useEffect, useState } from 'react';

/** A phone held sideways: landscape and short. The graphs then go full screen. */
export function useLandscape() {
  const q = '(orientation: landscape) and (max-height: 520px)';
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  const [h, setH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 0));
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => { setOn(mq.matches); setH(window.innerHeight); };
    mq.addEventListener('change', f); window.addEventListener('resize', f);
    return () => { mq.removeEventListener('change', f); window.removeEventListener('resize', f); };
  }, []);
  return { landscape: on, height: h };
}
