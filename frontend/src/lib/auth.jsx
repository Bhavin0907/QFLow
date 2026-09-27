import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('qf_user')
    return raw ? JSON.parse(raw) : null
  })

  const save = useCallback((data) => {
    localStorage.setItem('qf_token', data.access_token)
    localStorage.setItem('qf_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('qf_token')
    localStorage.removeItem('qf_user')
    setUser(null)
  }, [])

  // Validate a stored session once on load
  useEffect(() => {
    if (!user) return
    api('/api/auth/me').catch((e) => {
      if (e.status === 401) logout()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const login = (email, password) => api('/api/auth/login', { method: 'POST', body: { email, password } }).then(save)
  const register = (name, email, password) =>
    api('/api/auth/register', { method: 'POST', body: { name, email, password } }).then(save)
  const guest = (name) => api('/api/auth/guest', { method: 'POST', body: { name } }).then(save)

  return <AuthContext.Provider value={{ user, login, register, guest, logout }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function homeFor(role) {
  return role === 'admin' ? '/admin' : role === 'staff' ? '/staff' : '/student'
}
