import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fisherYatesShuffle,
  lufsToLinearGain,
  buildEmbyAuthHeader,
  buildJellyfinStreamUrl,
  buildSubsonicUrl,
  buildPlexStreamUrl,
  parseSpotifyExport,
  crossResolveTrack,
  EQ_PRESETS,
  ROTATING_SPITE_TAGLINES,
} from './musicLogic';
import type { Track } from '../types/music';

test('ROTATING_SPITE_TAGLINES includes all 3 required taglines', () => {
  assert.equal(ROTATING_SPITE_TAGLINES.length, 3);
  assert.ok(ROTATING_SPITE_TAGLINES[0].includes('Powered by spite and hard drives'));
  assert.ok(ROTATING_SPITE_TAGLINES[1].includes('Jellyfin + Navidrome + Emby + Plex'));
  assert.ok(ROTATING_SPITE_TAGLINES[2].includes('$11.99 a month is highway robbery'));
});

test('fisherYatesShuffle preserves all elements and does not mutate input', () => {
  const original = [1, 2, 3, 4, 5, 6];
  const copy = [...original];
  let seed = 0.15;
  const shuffled = fisherYatesShuffle(original, () => {
    seed = (seed + 0.37) % 1;
    return seed;
  });

  assert.deepEqual(original, copy);
  assert.equal(shuffled.length, original.length);
  assert.deepEqual([...shuffled].sort(), original);
});

test('lufsToLinearGain converts dB offsets accurately and clamps extremes', () => {
  assert.equal(lufsToLinearGain(0), 1);
  assert.equal(lufsToLinearGain(undefined), 1);
  // -6 dB is ~0.5012
  assert.equal(lufsToLinearGain(-6), 0.5012);
  // +6 dB is ~1.9953
  assert.equal(lufsToLinearGain(6), 1.9953);
  // Clamping below -12 dB
  assert.equal(lufsToLinearGain(-30), lufsToLinearGain(-12));
});

test('Jellyfin, Subsonic, and Plex URL builders produce spec-compliant endpoints', () => {
  const header = buildEmbyAuthHeader('tok123');
  assert.ok(header.includes('Client="Brokeify"'));
  assert.ok(header.includes('Device="BrokeifyMobile"'));
  assert.ok(header.includes('DeviceId="brokeify-01"'));
  assert.ok(header.includes('Token="tok123"'));

  const jfUniversal = buildJellyfinStreamUrl('https://jf.local/', 'item99', 'secretKey', 'user1', false);
  assert.ok(jfUniversal.startsWith('https://jf.local/Audio/item99/universal?'));
  assert.ok(jfUniversal.includes('api_key=secretKey'));

  const jfDirect = buildJellyfinStreamUrl('https://jf.local/', 'item99', 'secretKey', 'user1', true);
  assert.equal(jfDirect, 'https://jf.local/Items/item99/Download?api_key=secretKey');

  const subsonic = buildSubsonicUrl(
    'https://navi.local',
    'stream',
    { username: 'admin', token: 'md5tok', salt: 'salty' },
    { id: 'tr-42', maxBitRate: 320 }
  );
  assert.ok(subsonic.startsWith('https://navi.local/rest/stream.view?'));
  assert.ok(subsonic.includes('v=1.16.1'));
  assert.ok(subsonic.includes('c=Brokeify'));
  assert.ok(subsonic.includes('maxBitRate=320'));

  const plex = buildPlexStreamUrl('http://192.168.1.50:32400/', '/library/parts/104/file.flac', 'plexTok');
  assert.equal(plex, 'http://192.168.1.50:32400/library/parts/104/file.flac?X-Plex-Token=plexTok');
});

test('parseSpotifyExport and crossResolveTrack resolve tracks against catalog', () => {
  const raw = `
    # Exported Spotify Playlist
    The Midnight - Sunset (Remastered)
    Kavinsky - Nightcall
  `;
  const parsed = parseSpotifyExport(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].artist, 'The Midnight');
  assert.equal(parsed[0].title, 'Sunset (Remastered)');

  const catalog: Track[] = [
    {
      id: 't1',
      title: 'Sunset',
      artist: 'The Midnight',
      album: 'Endless Summer',
      duration: 210,
      source: 'navidrome',
      sourceName: 'Home Navidrome',
      streamUrl: 'synth://sunset',
      artworkUrl: '',
      accentColor: '#10b981',
    },
  ];

  const resolved = crossResolveTrack(parsed[0], catalog);
  assert.equal(resolved.matchedTrack?.id, 't1');
  assert.equal(resolved.confidence, 100);
});

test('EQ_PRESETS has 5 bands for each required preset', () => {
  for (const preset of ['Car Stereo', 'Bass Boost', 'Rock', 'Vocal', 'Late Night'] as const) {
    assert.equal(EQ_PRESETS[preset].length, 5);
  }
});
