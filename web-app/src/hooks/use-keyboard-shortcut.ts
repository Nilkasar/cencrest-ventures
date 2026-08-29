import { useEffect, useCallback } from 'react'

interface Options {
  meta?: boolean
  ctrl?: boolean
}

export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  options: Options = {}
) {
  const { meta = false, ctrl = false } = options

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase()) return
      if (meta && !e.metaKey) return
      if (ctrl && !e.ctrlKey) return
      e.preventDefault()
      callback()
    },
    [key, callback, meta, ctrl]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
