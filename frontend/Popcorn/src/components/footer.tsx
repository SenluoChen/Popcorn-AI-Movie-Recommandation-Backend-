import React from 'react';
import Box from '@mui/material/Box';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--brand-900)',
        borderTop: '4px solid var(--accent-500)',
        padding: '56px 20px 40px',
        mt: 0,
      }}
    >
      {/* Centered small logo with a subtle card for visual polish */}
      <Box sx={{ textAlign: 'center', mb: 2 }}>
        <Link to="/" aria-label="Popcorn home" style={{ display: 'inline-block' }}>
          <img
            src="/image.png"
            alt="Popcorn"
            style={{
              height: 34,
              width: 'auto',
              display: 'block',
              margin: '0 auto',
              borderRadius: 6,
              padding: 0,
              background: 'transparent',
              boxShadow: 'none',
            }}
          />
        </Link>
      </Box>

      <Box sx={{ mt: 2, textAlign: 'center', fontSize: 12, color: 'var(--surface-2)', opacity: 0.75 }}>
        <div>© 2025 Popcorn. Movie recommendations powered by AI.</div>
        <div style={{ marginTop: 4 }}>
          Data provided by TMDb. This product uses the TMDb API but is not endorsed or certified by TMDb.
        </div>
      </Box>
    </Box>
  );
}
