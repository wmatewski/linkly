import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { LinklyApp } from '../app.jsx'

export const Route = createFileRoute('/$')({ component: () => <ClientOnly fallback={null}><LinklyApp /></ClientOnly> })
