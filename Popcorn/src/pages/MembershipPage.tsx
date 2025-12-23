import React from 'react';
import { Container, Typography } from '@mui/material';

const MembershipPage: React.FC = () => {
  return (
    <Container sx={{ mt: 6 }}>
      <Typography variant="h4" align="center" gutterBottom>
        👑 Members Area
      </Typography>
      <Typography align="center">
        Welcome to the member center. This area can later show membership level, benefits, and upgrade plans.
      </Typography>
    </Container>
  );
};

export default MembershipPage;
