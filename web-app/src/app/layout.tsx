import type { Metadata } from 'next'
import { Inter, Fraunces, Spectral, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' })
const fraunces = Fraunces({ variable: '--font-fraunces', subsets: ['latin'], display: 'swap', axes: ['opsz'] })
const spectral = Spectral({ variable: '--font-spectral', subsets: ['latin'], display: 'swap', weight: ['400', '500', '600'] })
const jetbrains = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'BeBest', template: '%s · BeBest' },
  description: 'See why AI recommends your competitors.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${spectral.variable} ${jetbrains.variable} h-full`}
    >
      <body className="h-full bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  )
}
