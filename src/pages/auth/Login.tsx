import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase, setRememberMe } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { homePathForRole } from '@/lib/utils'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Modal } from '@/components/ui/Modal'
import logoUrl from '@/assets/maktab_logo_transparent.png'

// What the system actually does, in the office's own terms rather than by
// feature name. Kept short: this is read once, by someone signing in.
const FEATURES = [
  'Admissions, student records and printable ID cards',
  'Barcode attendance with sign-in and sign-out times',
  'Monthly fee invoices, challans and payment history',
  'Exam papers from a question bank, marks and results',
  'Attendance and result reports emailed to guardians',
  'Timetables, course planners and teacher salaries',
]

const APP_VERSION = '0.1.0'

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a17.6 17.6 0 0 1-2.36 3.4M6.1 6.1C3.3 7.9 1 11 1 11s4 7 11 7a10.9 10.9 0 0 0 4.24-.85" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4Z" />
    </svg>
  )
}

export function Login() {
  const { session, profile, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMeChecked, setRememberMeChecked] = useState(true)
  const [capsLockOn, setCapsLockOn] = useState(false)

  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotSubmitting, setForgotSubmitting] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)

  if (!loading && session && profile) {
    if (profile.must_reset_password) return <Navigate to="/reset-password" replace />
    return <Navigate to={homePathForRole(profile.role)} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    setRememberMe(rememberMeChecked)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (error) {
      setError('Invalid email or password. Please try again.')
    }
  }

  function handlePasswordKey(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLockOn(e.getModifierState('CapsLock'))
  }

  function openForgotPassword() {
    setForgotEmail(email)
    setForgotError(null)
    setForgotSent(false)
    setShowForgotPassword(true)
  }

  async function handleForgotSubmit(e: FormEvent) {
    e.preventDefault()
    setForgotError(null)
    if (!forgotEmail.trim()) {
      setForgotError('Enter your email address first.')
      return
    }
    setForgotSubmitting(true)
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setForgotSubmitting(false)
    // Show the same success message whether or not the address has an
    // account, so this can't be used to check who's registered.
    if (error) {
      setForgotError(error.message)
      return
    }
    setForgotSent(true)
  }

  return (
    <div className="relative flex min-h-dvh bg-cream-50 dark:bg-slate-900">
      <div
        className="absolute right-4 z-10 sm:right-6"
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
      >
        <ThemeToggle />
      </div>
      <p
        className="absolute right-4 z-10 text-xs text-slate-400 dark:text-slate-500 sm:right-6"
        style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        Version {APP_VERSION}
      </p>

      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 p-12 lg:flex">
        {/* The crest again, oversized and faint behind the copy. Decorative
            only, so it is hidden from assistive tech and never intercepts a
            click on the text above it. */}
        <img
          src={logoUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 -right-20 w-[36rem] max-w-none opacity-[0.06] select-none"
        />
        <div className="relative flex items-center gap-5">
          <img src={logoUrl} alt="Maktab - The Educational Institute crest" className="h-24 w-auto" />
          <div>
            <p className="font-serif text-4xl font-semibold tracking-wide text-gold-400">MAKTAB</p>
            <p className="text-base text-cream-200/80">The Educational Institute</p>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-serif text-3xl font-semibold leading-snug text-cream-50">
            Excellence in education,
            <br />
            simplified in one system.
          </h1>
          <p className="mt-4 max-w-sm text-sm text-cream-200/80">
            One dashboard for the academy&rsquo;s whole academic and administrative life &mdash; no
            spreadsheets, no paper registers.
          </p>
          <ul className="mt-6 max-w-md space-y-2.5">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-sm text-cream-100/90">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-cream-200/50">
          &copy; {new Date().getFullYear()} Maktab - The Educational Institute
        </p>
      </div>

      <div className="flex w-full flex-col items-center justify-center px-4 lg:w-1/2">
        <div className="w-full max-w-sm rounded-2xl border border-gold-400/30 bg-white p-8 shadow-lg dark:border-gold-500/20 dark:bg-slate-800">
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <img src={logoUrl} alt="Maktab - The Educational Institute crest" className="mb-3 h-20 w-auto" />
            <p className="font-serif text-2xl font-semibold tracking-wide text-brand-700 dark:text-gold-400">
              MAKTAB
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">The Educational Institute</p>
          </div>
          <h1 className="mb-1 text-xl font-semibold text-brand-800 dark:text-cream-50">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Email
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <MailIcon />
                </span>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder="you@school.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
                />
              </div>
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Password
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <LockIcon />
                </span>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={handlePasswordKey}
                  onKeyDown={handlePasswordKey}
                  className="w-full rounded-lg border border-slate-300 py-2 pl-10 pr-10 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {capsLockOn && (
                <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">Caps Lock is on</p>
              )}
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={rememberMeChecked}
                  onChange={(e) => setRememberMeChecked(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={openForgotPassword}
                className="text-sm font-medium text-brand-600 hover:underline dark:text-gold-400"
              >
                Forgot password?
              </button>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gold-500/50 bg-brand-700 px-3 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              {submitting && <Spinner />}
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      {showForgotPassword && (
        <Modal title="Reset your password" onClose={() => setShowForgotPassword(false)}>
          {forgotSent ? (
            <div className="space-y-4 text-sm">
              <p className="text-slate-600 dark:text-slate-300">
                If an account exists for <strong>{forgotEmail}</strong>, a password reset link has been sent.
                Check the inbox and follow the link to choose a new password.
              </p>
              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-full rounded-lg border border-gold-500/50 bg-brand-700 px-3 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 dark:bg-brand-600 dark:hover:bg-brand-500"
              >
                Close
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Enter the email address on your account and a reset link will be sent to it.
              </p>
              <div>
                <label htmlFor="forgotEmail" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Email
                </label>
                <input
                  id="forgotEmail"
                  type="email"
                  required
                  autoFocus
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-900 dark:text-cream-50"
                />
              </div>
              {forgotError && <p className="text-sm text-red-600 dark:text-red-400">{forgotError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(false)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={forgotSubmitting}
                  className="rounded-lg border border-gold-500/50 bg-brand-700 px-3 py-2 text-sm font-medium text-cream-50 transition-colors hover:bg-brand-800 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
                >
                  {forgotSubmitting ? 'Sending...' : 'Send reset link'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  )
}
