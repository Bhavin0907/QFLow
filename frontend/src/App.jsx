import { Navigate, Route, Routes } from 'react-router-dom'
import { homeFor, useAuth } from './lib/auth'
import Login from './pages/Login'
import Student from './pages/Student'
import Join from './pages/Join'
import Staff from './pages/Staff'
import Admin from './pages/Admin'
import Display from './pages/Display'

function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return children
}

function Home() {
  const { user } = useAuth()
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/join/:serviceId" element={<Join />} />
      <Route path="/display" element={<Display />} />
      <Route path="/display/:serviceId" element={<Display />} />
      <Route path="/student" element={<RequireRole roles={['student']}><Student /></RequireRole>} />
      <Route path="/staff" element={<RequireRole roles={['staff', 'admin']}><Staff /></RequireRole>} />
      <Route path="/admin" element={<RequireRole roles={['admin']}><Admin /></RequireRole>} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
