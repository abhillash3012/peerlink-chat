(() => {
  // Set this in public/config.js after deploying the backend.
  const serverUrl = window.PEERLINK_SERVER_URL || window.location.origin;
  const socket = io(serverUrl, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    timeout: 20000
  });
  const $ = (id) => document.getElementById(id);
  const joinPanel = $("joinPanel");
  const chatPanel = $("chatPanel");
  const joinForm = $("joinForm");
  const usernameInput = $("username");
  const roomInput = $("room");
  const messages = $("messages");
  const messageInput = $("messageInput");
  const sendButton = $("sendButton");
  const fileInput = $("fileInput");
  const sendFileButton = $("sendFileButton");
  const selectedFileBox = $("selectedFile");
  const transferStatus = $("transferStatus");
  let me = null;
  let selectedFile = null;
  let toastTimer = null;
  let receivedCount = 0;
  let sentCount = 0;

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }
  function setConnection(connected, text) {
    $("connectionDot").classList.toggle("green", connected);
    $("connectionLabel").textContent = text;
  }
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  function timeText(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
    catch { return ""; }
  }
  function addSystem(text, at = new Date().toISOString()) {
    const el = document.createElement("div");
    el.className = "message system";
    el.textContent = `${text} · ${timeText(at)}`;
    messages.appendChild(el);
    scrollMessages();
  }
  function scrollMessages() { messages.scrollTop = messages.scrollHeight; }
  function hideEmpty() {
    const empty = $("emptyState");
    if (empty) empty.remove();
  }
  function addMessage(data) {
    hideEmpty();
    const own = me && data.ownSocketId === me.socketId;
    const wrapper = document.createElement("div");
    wrapper.className = `message${own ? " own" : ""}`;
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const who = document.createElement("span");
    who.textContent = own ? "You" : (data.username || "User");
    const time = document.createElement("span");
    time.textContent = timeText(data.at);
    meta.append(who, time);
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = data.text;
    wrapper.append(meta, bubble);
    messages.appendChild(wrapper);
    scrollMessages();
  }
  function renderUsers(users) {
    $("peerCount").textContent = users.length;
    $("peerList").replaceChildren();
    if (!users.length) {
      $("peerList").innerHTML = '<div class="muted small-text">No one connected yet</div>';
      return;
    }
    users.forEach((user) => {
      const row = document.createElement("div"); row.className = "peer-row";
      const avatar = document.createElement("div"); avatar.className = "avatar";
      avatar.textContent = (user.username || "U").slice(0, 1).toUpperCase();
      const info = document.createElement("div"); info.className = "peer-info";
      const name = document.createElement("strong"); name.textContent = user.username;
      const state = document.createElement("span"); state.textContent = "In this room";
      info.append(name, state); row.append(avatar, info);
      if (me && user.id === me.socketId) {
        const tag = document.createElement("span"); tag.className = "you-tag"; tag.textContent = "YOU"; row.append(tag);
      }
      $("peerList").appendChild(row);
    });
    $("peerStrip").replaceChildren();
    const dot = document.createElement("span"); dot.className = "status-dot green";
    const text = document.createElement("span");
    text.textContent = users.length > 1 ? `${users.length} users in room — ready to chat and share` : "You're in the room — waiting for another user to join…";
    $("peerStrip").append(dot, text);
    $("roomSubtitle").textContent = users.length > 1 ? `${users.length} participants are in this room` : "Waiting for another user to join…";
  }
  function addFileCard(file, isOwn, dataUrl) {
    const row = document.createElement("div"); row.className = "file-row";
    const icon = document.createElement("div"); icon.className = "file-icon"; icon.textContent = "↧";
    const detail = document.createElement("div"); detail.className = "file-detail";
    const name = document.createElement("strong"); name.textContent = file.name;
    const info = document.createElement("span"); info.textContent = `${formatSize(file.size)} · ${isOwn ? "Sent" : `From ${file.username || "peer"}`}`;
    detail.append(name, info); row.append(icon, detail);
    if (!isOwn && dataUrl) {
      const link = document.createElement("a"); link.className = "download-link"; link.href = dataUrl; link.download = file.name; link.textContent = "Download";
      row.append(link);
    } else if (isOwn) {
      const tag = document.createElement("span"); tag.className = "you-tag"; tag.textContent = "SENT"; row.append(tag);
    }
    $("receivedFiles").prepend(row);
    receivedCount++;
    $("fileCount").textContent = receivedCount;
  }
  function joinRoom(username, room) {
    setConnection(false, "Connecting…");
    socket.emit("join-room", { username, room }, (result) => {
      if (!result || !result.ok) {
        setConnection(false, "Not connected");
        toast(result?.error || "Could not join the room.");
        return;
      }
      me = { username: result.username, room: result.room, socketId: result.socketId };
      joinPanel.classList.add("hidden");
      chatPanel.classList.remove("hidden");
      $("roomTitle").textContent = result.room;
      $("roomSubtitle").textContent = "Waiting for another user to join…";
      messageInput.disabled = false;
      sendButton.disabled = false;
      fileInput.disabled = false;
      setConnection(true, "In room");
      messageInput.placeholder = "Type your message…";
      messageInput.focus();
      addSystem(`You joined room ${result.room}`);
      toast(`Joined room ${result.room}`);
    });
  }

  $("generateRoom").addEventListener("click", () => {
    roomInput.value = `room-${Math.random().toString(36).slice(2, 7)}`;
  });
  joinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const room = roomInput.value.trim();
    if (!username || !room) { toast("Enter both a username and room ID."); return; }
    joinRoom(username, room);
  });

  $("copyRoom").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(me.room);
      toast("Room ID copied.");
    } catch {
      roomInput.value = me.room;
      toast(`Room ID: ${me.room}`);
    }
  });

  $("messageForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const text = messageInput.value.trim();
    if (!me) { toast("Join a room before chatting."); return; }
    if (!text) return;
    socket.emit("chat-message", { text }, (result) => {
      if (result?.ok) messageInput.value = "";
      else toast(result?.error || "Message could not be sent.");
    });
  });

  function chooseFile(file) {
    if (!file) return;
    if (!me) { toast("Join a room before sharing files."); return; }
    if (file.size > 8 * 1024 * 1024) {
      selectedFile = null;
      selectedFileBox.classList.add("hidden");
      sendFileButton.disabled = true;
      toast("Please choose a file smaller than 8 MB.");
      return;
    }
    selectedFile = file;
    selectedFileBox.classList.remove("hidden");
    selectedFileBox.textContent = `${file.name} · ${formatSize(file.size)}`;
    sendFileButton.disabled = false;
    transferStatus.textContent = "Ready to share. The file will be sent to other users in this room.";
  }
  fileInput.addEventListener("change", () => chooseFile(fileInput.files[0]));
  const dropZone = $("dropZone");
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropZone.style.borderColor = "#3269d8";
  }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropZone.style.borderColor = "";
  }));
  dropZone.addEventListener("drop", (event) => chooseFile(event.dataTransfer.files[0]));

  sendFileButton.addEventListener("click", async () => {
    if (!selectedFile || !me) return;
    sendFileButton.disabled = true;
    transferStatus.textContent = "Preparing file…";
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read this file."));
        reader.readAsDataURL(selectedFile);
      });
      transferStatus.textContent = "Sending file to room…";
      socket.emit("share-file", {
        name: selectedFile.name,
        type: selectedFile.type || "application/octet-stream",
        size: selectedFile.size,
        data: dataUrl
      }, (result) => {
        if (result?.ok) {
          transferStatus.textContent = "File sent to the room.";
          toast("File shared successfully.");
          selectedFile = null;
          fileInput.value = "";
          selectedFileBox.classList.add("hidden");
          sendFileButton.disabled = true;
        } else {
          transferStatus.textContent = result?.error || "File transfer failed.";
          toast(result?.error || "File transfer failed.");
          sendFileButton.disabled = false;
        }
      });
    } catch (error) {
      transferStatus.textContent = error.message;
      sendFileButton.disabled = false;
    }
  });

  socket.on("room-users", (users) => {
    if (!me) return;
    renderUsers(users);
    if (users.length > 1) setConnection(true, "Room active");
  });
  socket.on("chat-message", (data) => addMessage(data));
  socket.on("system-message", (data) => addSystem(data.text, data.at));
  socket.on("shared-file", (data) => {
    try {
      const cardData = data.data;
      addFileCard(data, false, cardData);
      addSystem(`${data.username} shared a file: ${data.name}`, data.at);
      toast(`Received file: ${data.name}`);
    } catch {
      toast("A file arrived but could not be displayed.");
    }
  });
  socket.on("file-sent", (data) => {
    addFileCard(data, true, null);
    sentCount++;
  });
  socket.on("connect", () => {
    if (me) setConnection(true, "Reconnected");
  });
  socket.on("disconnect", () => {
    setConnection(false, "Server disconnected");
    if (me) addSystem("Connection to the server was lost. Reconnecting…");
  });

  $("leaveButton").addEventListener("click", () => {
    location.reload();
  });
})();
