import { useCallback, useState } from 'react';

/** One id per submission, kept until it is saved: a double tap or a retry after a weak connection sends the same id,
 *  and the database saves it once. `next()` after a save starts a new one. */
export function useSubmitId(): [string, () => void] {
  const [id, setId] = useState(() => crypto.randomUUID());
  return [id, useCallback(() => setId(crypto.randomUUID()), [])];
}
