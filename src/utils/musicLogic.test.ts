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
  buildJellyfinDisplayPrefsUrl,
  serializeCloudSettingsPayload,
  parseCloudSettingsResponse,
  mergeProvidersPreservingAuth,
  isLikelyJellyfinApiKey,
  matchJellyfinUserFromList,
} from './musicLogic';
import type { BrokeifyCloudSettings, ProviderConfig, Track } from '../types/music';

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
  assert.ok(header.includes('Device="BrokeifyWeb"'));
  assert.ok(header.includes('DeviceId="brokeify-01"'));
  assert.ok(header.includes('Token="tok123"'));

  const jfUniversal = buildJellyfinStreamUrl('https://jellyfin.flockingreeds.farm/', 'item99', 'secretKey', 'user1', false);
  assert.ok(jfUniversal.startsWith('https://jellyfin.flockingreeds.farm/Audio/item99/universal?'));
  assert.ok(jfUniversal.includes('Container=opus%2Cmp3%2Caac%2Cflac%2Cwav'));
  assert.ok(jfUniversal.includes('AudioCodec=mp3'));
  assert.ok(jfUniversal.includes('api_key=secretKey'));

  const jfDirect = buildJellyfinStreamUrl('https://jellyfin.flockingreeds.farm/', 'item99', 'secretKey', 'user1', true);
  assert.equal(jfDirect, 'https://jellyfin.flockingreeds.farm/Items/item99/Download?api_key=secretKey');

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

test('isLikelyJellyfinApiKey and matchJellyfinUserFromList support Method A API Key authentication', () => {
  assert.equal(isLikelyJellyfinApiKey('a1b2c3d4e5f60718293a4b5c6d7e8f90'), true);
  assert.equal(isLikelyJellyfinApiKey('my-regular-password'), false);

  const sampleUsers = [
    { Id: 'u-guest', Name: 'Guest', Policy: { IsAdministrator: false } },
    { Id: 'u-nicky', Name: 'Nicky', Policy: { IsAdministrator: true } },
  ];
  assert.deepEqual(matchJellyfinUserFromList(sampleUsers, 'nicky'), {
    id: 'u-nicky',
    name: 'Nicky',
  });
  assert.deepEqual(matchJellyfinUserFromList(sampleUsers, ''), {
    id: 'u-nicky',
    name: 'Nicky',
  });
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

test('Jellyfin DisplayPreferences Cloud Sync URL, serialization, and parsing round-trip cleanly', () => {
  const url = buildJellyfinDisplayPrefsUrl('https://jf.homelab.local/', 'user-42');
  assert.equal(
    url,
    'https://jf.homelab.local/DisplayPreferences/brokeify?userId=user-42&client=Brokeify'
  );

  const sampleSettings: BrokeifyCloudSettings = {
    version: 1,
    updatedAt: '2026-10-31T20:00:00.000Z',
    audioPrefs: {
      eqPreset: 'Bass Boost',
      eqGains: [6.5, 4.0, 0, 0.5, 1.5],
      carVolumeLeveler: true,
      lufsNormalizationEnabled: true,
      shuffleEnabled: true,
      repeatMode: 'all',
    },
    providers: [],
    playlists: [],
  };

  const payload = serializeCloudSettingsPayload(sampleSettings);
  assert.equal(payload.Id, 'brokeify');
  assert.equal(payload.Client, 'Brokeify');
  assert.ok(payload.CustomPrefs.brokeify_cloud_state);

  const restored = parseCloudSettingsResponse(payload);
  assert.ok(restored);
  assert.equal(restored.audioPrefs.eqPreset, 'Bass Boost');
  assert.deepEqual(restored.audioPrefs.eqGains, [6.5, 4.0, 0, 0.5, 1.5]);
  assert.equal(restored.audioPrefs.shuffleEnabled, true);
});

test('mergeProvidersPreservingAuth never clears saved auth tokens on offline or empty updates', () => {
  const existing: ProviderConfig[] = [
    {
      id: 'prov-jellyfin',
      type: 'jellyfin',
      name: 'Jellyfin Media Server',
      enabled: true,
      serverUrl: 'https://jf.myhome.net',
      username: 'nreed',
      token: 'persisted-jf-token-999',
      userId: 'jf-uid-1',
      status: 'connected',
    },
  ];

  const incomingAfterTimeout: ProviderConfig[] = [
    {
      id: 'prov-jellyfin',
      type: 'jellyfin',
      name: 'Jellyfin Media Server',
      enabled: true,
      serverUrl: 'https://jf.myhome.net',
      username: 'nreed',
      token: '', // Empty token from failed/partial response must NOT overwrite saved token
      userId: '',
      status: 'connected',
    },
  ];

  const merged = mergeProvidersPreservingAuth(existing, incomingAfterTimeout);
  assert.equal(merged[0].token, 'persisted-jf-token-999');
  assert.equal(merged[0].userId, 'jf-uid-1');
});

