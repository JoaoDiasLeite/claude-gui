import React from 'react'
import { createRoot } from 'react-dom/client'
import Overlay from './Overlay'
import '../styles/global.css'
import '../styles/shared.css'
import './Overlay.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>
)
