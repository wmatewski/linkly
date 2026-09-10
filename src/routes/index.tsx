import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { LegacyApp } from '../main.jsx'

export const Route = createFileRoute('/')({
  component: () => (
    <ClientOnly fallback={null}>
      <LegacyApp />
    </ClientOnly>
  ),
})