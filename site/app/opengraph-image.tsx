import { ImageResponse } from "next/og";

export const alt = "Beacon — you ship, Beacon drafts the tweet";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#F4F4F0",
          border: "16px solid #000",
          padding: "64px 72px",
          fontFamily: "Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 36 }}>
          <div
            style={{
              display: "flex",
              background: "#FFC900",
              border: "5px solid #000",
              boxShadow: "10px 10px 0 #000",
              padding: "10px 26px",
              fontSize: 44,
              fontWeight: 800,
              transform: "rotate(-2deg)",
            }}
          >
            Beacon
          </div>
          <div
            style={{
              display: "flex",
              background: "#FF90E8",
              border: "5px solid #000",
              boxShadow: "10px 10px 0 #000",
              padding: "10px 22px",
              fontSize: 28,
              fontWeight: 800,
              transform: "rotate(2deg)",
            }}
          >
            never auto-posted
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 92,
            fontWeight: 800,
            lineHeight: 1.02,
            letterSpacing: "-0.03em",
            color: "#000",
            maxWidth: 980,
          }}
        >
          You ship. Beacon drafts the tweet.
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 44,
            background: "#171714",
            color: "#F4F4F0",
            border: "5px solid #000",
            boxShadow: "10px 10px 0 #000",
            padding: "18px 28px",
            fontSize: 30,
            fontFamily: "monospace",
            alignSelf: "flex-start",
          }}
        >
          npm install -g beacon-bip
        </div>
      </div>
    ),
    { ...size },
  );
}
