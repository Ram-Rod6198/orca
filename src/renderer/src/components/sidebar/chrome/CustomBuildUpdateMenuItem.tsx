import React, { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'

/** Rebuilds and reinstalls a self-built Orca from the latest Orca code; hidden when no updater is installed. */
export function CustomBuildUpdateMenuItem(): React.JSX.Element | null {
  const t = useTranslate()
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let live = true
    void window.api.app
      .customBuildUpdateAvailable?.()
      .then((value) => live && setAvailable(value))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  if (!available) {
    return null
  }
  const start = (): void => {
    void window.api.app.startCustomBuildUpdate?.().then((started) => {
      if (started) {
        toast.message(
          t(
            'auto.components.sidebar.CustomBuildUpdateMenuItem.started',
            'Updating in its own window. Orca closes and reopens when the new build is ready.'
          )
        )
      }
    })
  }
  return (
    <DropdownMenuItem onSelect={start}>
      <Download className="size-3.5" />
      {t('auto.components.sidebar.CustomBuildUpdateMenuItem.label', 'Update Your Build')}
    </DropdownMenuItem>
  )
}
