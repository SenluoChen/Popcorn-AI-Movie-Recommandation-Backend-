import { tmdbImage } from './utils/tmdb';

test('tmdbImage builds an image URL', () => {
  expect(tmdbImage('/abc.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/abc.jpg');
  expect(tmdbImage(null)).toBe('');
});
