import React from 'react'
import { createRoot } from 'react-dom/client'
import Toast from './Toast'
import '../styles/global.css'
import './Toast.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toast />
  </React.StrictMode>
)
