import './globals.css'
export const metadata = { title: process.env.NEXT_PUBLIC_APP_NAME || 'AI Hub Fusion' }

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  )
}
