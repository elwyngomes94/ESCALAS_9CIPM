/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Peculio from './pages/Peculio';
import ServiceTypes from './pages/ServiceTypes';
import VolunteersPJES from './pages/VolunteersPJES';
import VolunteersOPS from './pages/VolunteersOPS';
import CreateEscala from './pages/CreateEscala';
import Escalas from './pages/Escalas';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/escalas" element={<Escalas />} />
            <Route path="/peculio" element={<Peculio />} />
            <Route path="/servicos" element={<ServiceTypes />} />
            <Route path="/voluntarios-pjes" element={<VolunteersPJES />} />
            <Route path="/voluntarios-ops" element={<VolunteersOPS />} />
            <Route path="/criar-escala" element={<CreateEscala />} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

