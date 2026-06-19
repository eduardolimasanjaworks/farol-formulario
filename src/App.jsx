import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import SDR from './pages/SDR';
import UsersAdmin from './pages/UsersAdmin';
import NotificationsAdmin from './pages/NotificationsAdmin';
import ScheduleAdmin from './pages/ScheduleAdmin';
import { getAuthSession, isAdminSession } from './utils/authSession';

const ProtectedRoute = ({ children }) => {
  const { token } = getAuthSession();
  return token ? children : <Navigate to="/login" replace />;
};

const AdminRoute = ({ children }) => {
  const session = getAuthSession();
  if (!session.token) return <Navigate to="/login" replace />;
  return isAdminSession(session) ? children : <Navigate to="/sdr" replace />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route 
          path="/sdr" 
          element={
            <ProtectedRoute>
              <SDR />
            </ProtectedRoute>
          } 
        />
        <Route
          path="/admin/users"
          element={
            <AdminRoute>
              <UsersAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <AdminRoute>
              <NotificationsAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/schedule"
          element={
            <AdminRoute>
              <ScheduleAdmin />
            </AdminRoute>
          }
        />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
