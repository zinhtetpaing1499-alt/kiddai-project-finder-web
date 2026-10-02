import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import {
  activeCall,
  endCall,
  fetchCallSignals,
  postCallSignal,
  startCall,
  type ProjectCall as ProjectCallInfo,
} from "./api";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

type RemoteView = { userId: number; stream: MediaStream };

export function ProjectCall({
  groupId,
  meId,
  request,
  onRequestHandled,
}: {
  groupId: number;
  meId: number;
  request: "audio" | "video" | null;
  onRequestHandled: () => void;
}) {
  const [call, setCall] = useState<ProjectCallInfo | null>(null);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState("");
  const [remotes, setRemotes] = useState<RemoteView[]>([]);
  const localVideo = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<number, RTCPeerConnection>());
  const after = useRef(0);
  const callRef = useRef<ProjectCallInfo | null>(null);
  callRef.current = call;

  function stopLocal() {
    for (const peer of peers.current.values()) peer.close();
    peers.current.clear();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    setRemotes([]);
    setJoined(false);
  }

  async function openMedia(kind: "audio" | "video") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" });
    localStream.current = stream;
    if (localVideo.current) localVideo.current.srcObject = stream;
    return stream;
  }

  function makePeer(remoteId: number, stream: MediaStream) {
    const existing = peers.current.get(remoteId);
    if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    for (const track of stream.getTracks()) peer.addTrack(track, stream);
    peer.onicecandidate = (event) => {
      const current = callRef.current;
      if (!event.candidate || !current) return;
      void postCallSignal(groupId, current.id, "ice", { to: remoteId, candidate: event.candidate.toJSON() });
    };
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteStream) return;
      setRemotes((current) => {
        const next = current.filter((item) => item.userId !== remoteId);
        return [...next, { userId: remoteId, stream: remoteStream }];
      });
    };
    peers.current.set(remoteId, peer);
    return peer;
  }

  async function join(next: ProjectCallInfo) {
    setError("");
    try {
      const stream = await openMedia(next.kind);
      setJoined(true);
      setCall(next);
      if (next.startedBy.id !== meId) {
        const peer = makePeer(next.startedBy.id, stream);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await postCallSignal(groupId, next.id, "offer", { to: next.startedBy.id, sdp: offer });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The camera or microphone could not be opened.");
      stopLocal();
    }
  }

  useEffect(() => {
    if (!request) return;
    let cancel = false;
    startCall(groupId, request)
      .then((next) => {
        if (cancel) return;
        onRequestHandled();
        void join(next);
      })
      .catch((reason) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : "The call could not start.");
        onRequestHandled();
      });
    return () => {
      cancel = true;
    };
    // join uses the latest media helpers; the request is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, groupId]);

  useEffect(() => {
    let cancel = false;
    async function watch() {
      try {
        const result = await activeCall(groupId);
        if (cancel) return;
        setCall((current) => {
          if (joined && current && !result.call) return current;
          return result.call;
        });
        if (!result.call) return;
        if (!joined && result.call.startedBy.id === meId && localStream.current) setJoined(true);
      } catch {
        /* keep the last call state */
      }
    }
    void watch();
    const timer = window.setInterval(() => void watch(), 2000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [groupId, joined, meId]);

  useEffect(() => {
    if (!call || !joined) return;
    let cancel = false;
    async function pull() {
      const current = callRef.current;
      if (!current) return;
      const result = await fetchCallSignals(groupId, current.id, after.current);
      if (cancel) return;
      if (result.status === "ended") {
        stopLocal();
        setCall(null);
        return;
      }
      for (const signal of result.signals) {
        after.current = Math.max(after.current, signal.id);
        if (signal.userId === meId) continue;
        if (signal.payload.to && signal.payload.to !== meId) continue;
        const stream = localStream.current;
        if (!stream) continue;
        if (signal.kind === "offer" && signal.payload.sdp && current.startedBy.id === meId) {
          const peer = makePeer(signal.userId, stream);
          await peer.setRemoteDescription(signal.payload.sdp);
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await postCallSignal(groupId, current.id, "answer", { to: signal.userId, sdp: answer });
        }
        if (signal.kind === "answer" && signal.payload.sdp) {
          const peer = peers.current.get(signal.userId);
          if (peer) await peer.setRemoteDescription(signal.payload.sdp);
        }
        if (signal.kind === "ice" && signal.payload.candidate) {
          const peer = peers.current.get(signal.userId);
          if (peer) await peer.addIceCandidate(signal.payload.candidate);
        }
        if (signal.kind === "hangup") {
          peers.current.get(signal.userId)?.close();
          peers.current.delete(signal.userId);
          setRemotes((items) => items.filter((item) => item.userId !== signal.userId));
        }
      }
    }
    void pull();
    const timer = window.setInterval(() => void pull().catch(() => undefined), 1000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [call, groupId, joined, meId]);

  useEffect(() => () => stopLocal(), []);

  async function hangUp() {
    const current = callRef.current;
    stopLocal();
    setCall(null);
    if (current) {
      await postCallSignal(groupId, current.id, "hangup", {}).catch(() => undefined);
      await endCall(groupId, current.id).catch(() => undefined);
    }
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
  }

  function toggleCamera() {
    const next = !cameraOff;
    setCameraOff(next);
    localStream.current?.getVideoTracks().forEach((track) => {
      track.enabled = !next;
    });
  }

  const incoming = call && !joined && call.startedBy.id !== meId;
  if (!call && !error) return null;

  return (
    <section className="company-call" aria-label={call?.kind === "video" ? "Video call" : "Voice call"}>
      {error ? <p className="company-error">{error}</p> : null}
      {incoming && call ? (
        <div className="company-call__incoming">
          <strong>{call.startedBy.displayName}</strong>
          <span>{call.kind === "video" ? "Video call" : "Voice call"}</span>
          <button type="button" onClick={() => void join(call)}>
            <Phone size={16} /> Answer
          </button>
          <button type="button" onClick={() => void hangUp()}>
            Decline
          </button>
        </div>
      ) : null}
      {joined ? (
        <div className="company-call__room">
          <div className="company-call__videos">
            {remotes.map((remote) => (
              <RemoteVideo key={remote.userId} stream={remote.stream} />
            ))}
            <video ref={localVideo} className="company-call__local" muted autoPlay playsInline />
          </div>
          <div className="company-call__controls">
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            {call?.kind === "video" ? (
              <button type="button" onClick={toggleCamera} aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}>
                {cameraOff ? <VideoOff size={18} /> : <Video size={18} />}
              </button>
            ) : null}
            <button type="button" className="company-call__end" onClick={() => void hangUp()} aria-label="End call">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline />;
}
