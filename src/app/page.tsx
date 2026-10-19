'use client'

import dynamic from 'next/dynamic'

const App = dynamic(() => import('@/components/expense-tracker/App').then(m => m.App), {
  ssr: false,
  loading: () => null,
})

export default function Home() {
  return <App />
}
