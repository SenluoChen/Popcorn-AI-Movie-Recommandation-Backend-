import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import FacebookIcon from '@mui/icons-material/Facebook';
import InstagramIcon from '@mui/icons-material/Instagram';

export default function Footer() {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--brand-900)',
        borderTop: '4px solid var(--accent-500)',
        padding: '64px 20px 44px',
        mt: 0,
      }}
    >
      {/*
 * note: 主體內容：四欄
 */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-around',
          gap: 6,
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        {/*
 * note: 第一欄
 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: 'var(--surface-2)', fontSize: 18 }}
          >
            Qui sommes-nous ?
          </Typography>
          {['Nos engagements', 'Le blog', 'Nous rejoindre', 'Mentions légales'].map(
            (text) => (
              <Typography key={text} sx={{ my: 0.5 }}>
                <Link
                  href="#"
                  underline="hover"
                  sx={{
                    color: 'var(--text-invert)',
                    opacity: 0.85,
                    '&:hover': { color: 'var(--accent-500)', opacity: 1 },
                  }}
                >
                  {text}
                </Link>
              </Typography>
            )
          )}
        </Box>

        {/*
 * note: 第二欄
 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: 'var(--surface-2)', fontSize: 18 }}
          >
            Aide
          </Typography>
          {['Livraison', 'Paiement', 'Contact'].map((text) => (
            <Typography key={text} sx={{ my: 0.5 }}>
              <Link
                href="#"
                underline="hover"
                sx={{
                  color: 'var(--text-invert)',
                  opacity: 0.85,
                  '&:hover': { color: 'var(--accent-500)', opacity: 1 },
                }}
              >
                {text}
              </Link>
            </Typography>
          ))}
        </Box>

        {/*
 * note: 第三欄
 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: 'var(--surface-2)', fontSize: 18 }}
          >
            Recyclage
          </Typography>
          {['Suggestions', 'Top plateformes', 'Nouveautés'].map((text) => (
            <Typography key={text} sx={{ my: 0.5 }}>
              <Link
                href="#"
                underline="hover"
                sx={{
                  color: 'var(--text-invert)',
                  opacity: 0.85,
                  '&:hover': { color: 'var(--accent-500)', opacity: 1 },
                }}
              >
                {text}
              </Link>
            </Typography>
          ))}
        </Box>

        {/*
 * quick note: 第四欄
 */}
        <Box sx={{ minWidth: 180 }}>
          <Typography
            fontWeight="bold"
            gutterBottom
            sx={{ color: 'var(--surface-2)', fontSize: 18 }}
          >
            Villes
          </Typography>
          {['Paris', 'Bordeaux', 'Lyon', 'Nantes', 'Strasbourg'].map((text) => (
            <Typography key={text} sx={{ color: 'var(--text-invert)', opacity: 0.85, my: 0.5 }}>
              {text}
            </Typography>
          ))}
        </Box>
      </Box>

      {/*
 * quick note: 分隔線
 */}
      <Box
        sx={{
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.06)',
          my: 5,
          maxWidth: 1200,
          mx: 'auto',
        }}
      />

      {/*
 * quick note: Social Icons + Newsletter
 */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
        }}
      >
        {/*
 * quick note: Social Icons
 */}
        <Box sx={{ display: 'flex', gap: 3 }}>
          <FacebookIcon
            sx={{ color: 'var(--surface-2)', fontSize: 32, cursor: 'pointer', opacity: 0.95, '&:hover': { color: 'var(--accent-500)' } }}
          />
          <InstagramIcon
            sx={{ color: 'var(--surface-2)', fontSize: 32, cursor: 'pointer', opacity: 0.95, '&:hover': { color: 'var(--accent-500)' } }}
          />
        </Box>

        {/*
        {/* newsletter removed per request */}
      </Box>

      {/*
 * 註：底部資訊
 */}
      <Box
        sx={{
          mt: 5,
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--surface-2)',
          opacity: 0.95,
        }}
      >
        © 2025 Popcorn AI. All rights reserved.
      </Box>
    </Box>
  );
}
