import { ImageResponse } from 'next/og';

import { LINK_PREVIEW_IMAGE_SIZE, type LinkPreviewDetails } from '@/lib/with-md/link-preview';

const headerValue = 'noindex, nofollow, noarchive';

export function renderLinkPreviewImage(preview: LinkPreviewDetails): ImageResponse {
  const response = new ImageResponse(
    (
      <div
        style={{
          alignItems: 'stretch',
          background: '#151513',
          color: '#f7f7f2',
          display: 'flex',
          fontFamily: 'Arial, Helvetica, sans-serif',
          height: '100%',
          padding: 58,
          width: '100%',
        }}
      >
        <div
          style={{
            border: '2px solid #d5ff5f',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'space-between',
            padding: 44,
            width: '100%',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              textTransform: 'uppercase',
            }}
          >
            <div
              style={{
                color: '#d5ff5f',
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 0,
              }}
            >
              {preview.label}
            </div>
            <div
              style={{
                background: '#d5ff5f',
                color: '#151513',
                display: 'flex',
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: 0,
                padding: '10px 18px',
              }}
            >
              with.md
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div
              style={{
                display: 'flex',
                fontSize: 72,
                fontWeight: 800,
                letterSpacing: 0,
                lineHeight: 0.95,
                maxWidth: 930,
              }}
            >
              {preview.title}
            </div>
            <div
              style={{
                color: '#d8d4ca',
                display: 'flex',
                fontSize: 35,
                lineHeight: 1.22,
                maxWidth: 980,
              }}
            >
              {preview.description}
            </div>
          </div>

          <div
            style={{
              background: '#ff8f5f',
              display: 'flex',
              height: 14,
              width: 220,
            }}
          />
        </div>
      </div>
    ),
    LINK_PREVIEW_IMAGE_SIZE,
  );

  response.headers.set('X-Robots-Tag', headerValue);
  response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
  return response;
}
