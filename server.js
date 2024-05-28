const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql");
const bcrypt = require("bcrypt");
const requestIp = require("request-ip");
const WebSocket = require("ws");

const app = express();
const port = 8000;
const wsPort = 8081;

// Configurer les détails de connexion à la base de données MySQL
const connection = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "",
  database: "DEMONS",
});

// Middleware pour analyser les corps de requête au format JSON
app.use(bodyParser.json());
app.use(requestIp.mw());

// Créer le serveur WebSocket
const wss = new WebSocket.Server({ port: wsPort });

// Stocker les informations de connexion des clients
const clients = new Map();

// Route pour recevoir la demande d'identifiants
app.post("/demande-identifiants", (req, res) => {
  const { nomPc, ipAddress } = req.body.clientInfo;

  console.log("Requête de demande d'identifiants reçue : ", nomPc, ipAddress);

  // Générer un ID unique pour ce client
  const ID = generateID();

  // Enregistrer l'ID, le nom de l'ordinateur et l'adresse IP dans la base de données
  insertClientInfo(ID, nomPc, ipAddress)
    .then(() => {
      // Envoyer l'ID dans la réponse
      res.json({ ID });
    })
    .catch((error) => {
      console.error(
        "Erreur lors de l'enregistrement des données dans la base de données :",
        error
      );
      res.status(500).json({
        error: "Une erreur est survenue lors de l'enregistrement des données.",
      });
    });
});

// Route pour recevoir les demandes de connexion
app.post("/connexion", (req, res) => {
  const { ID } = req.body;

  // Rechercher les informations de l'ordinateur dans la base de données
  getComputerInfo(ID)
    .then((computerInfo) => {
      if (computerInfo) {
        const { ip_address } = computerInfo;

        // Envoyer la demande de connexion à l'adresse IP du destinataire via WebSocket
        sendConnectionRequest(ip_address, ID)
          .then(() => {
            // Enregistrer les informations de connexion du client initiateur
            registerConnectionInitiator(req.clientIp, ID, ip_address)
              .then(() => {
                res.json({
                  message: "Demande de connexion envoyée avec succès.",
                });
              })
              .catch((error) => {
                console.error(
                  "Erreur lors de l'enregistrement des informations de connexion :",
                  error
                );
                res.status(500).json({
                  error:
                    "Une erreur est survenue lors de l'enregistrement des informations de connexion.",
                });
              });
          })
          .catch((error) => {
            console.error(
              "Erreur lors de l'envoi de la demande de connexion :",
              error
            );
            res.status(500).json({
              error:
                "Une erreur est survenue lors de l'envoi de la demande de connexion.",
            });
          });
      } else {
        res.status(404).json({ error: "ID d'ordinateur non trouvé." });
      }
    })
    .catch((error) => {
      console.error(
        "Erreur lors de la recherche des informations d'ordinateur :",
        error
      );
      res.status(500).json({
        error:
          "Une erreur est survenue lors de la recherche des informations d'ordinateur.",
      });
    });
});

// Fonction pour générer un ID unique
function generateID() {
  return Math.floor(Math.random() * 1000000) + 1;
}

// Fonction pour insérer les informations du client dans la base de données
function insertClientInfo(ID, nomPC, ipAddress) {
  return new Promise((resolve, reject) => {
    // Valider le format de l'adresse IP à l'aide d'une expression régulière ou d'une bibliothèque de validation
    if (!validateIPAddress(ipAddress)) {
      reject(new Error("Format d'adresse IP invalide"));
      return;
    }

    const query =
      "INSERT INTO Client (ID, nom_PC, ip_Address) VALUES (?, ?, ?)";
    connection.query(query, [ID, nomPC, ipAddress], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Fonction pour récupérer les informations de l'ordinateur depuis la base de données
function getComputerInfo(ID) {
  return new Promise((resolve, reject) => {
    const query = "SELECT ip_address FROM Client WHERE ID = ?";
    connection.query(query, [ID], (err, result) => {
      if (err) {
        reject(err);
      } else {
        if (result.length > 0) {
          resolve(result[0]);
        } else {
          resolve(null);
        }
      }
    });
  });
}

// Fonction pour envoyer une demande de connexion à l'adresse IP spécifiée
function sendConnectionRequest(adresseIP, ID) {
  return new Promise((resolve, reject) => {
    // Rechercher la connexion WebSocket du destinataire
    const destinataire = clients.get(adresseIP);

    if (destinataire) {
      // Envoyer la demande de connexion au destinataire via WebSocket
      destinataire.send(JSON.stringify({ type: "connectionRequest", ID }));
      resolve();
    } else {
      reject(
        new Error(`Le client à l'adresse IP ${adresseIP} n'est pas connecté.`)
      );
    }
  });
}

// Fonction pour enregistrer les informations de connexion de l'initiateur
function registerConnectionInitiator(initiatorIP, ID, destinaireIP) {
  return new Promise((resolve, reject) => {
    // Enregistrer les informations de connexion de l'initiateur dans la base de données
    const query =
      "INSERT INTO Connexion (initiateur_ip, initiateur_id, destinataire_ip) VALUES (?, ?, ?, ?)";
    connection.query(query, [initiatorIP, ID, destinaireIP], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Fonction pour valider une adresse IP en utilisant une expression régulière
function validateIPAddress(ipAddress) {
  const ipv4Regex =
    /^(?<firstOctet>(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.(?<secondOctet>(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.(?<thirdOctet>(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.(?<fourthOctet>(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))$/;
  return ipv4Regex.test(ipAddress);
}

// Gérer les connexions entrantes sur le serveur WebSocket
wss.on("connection", (ws, req) => {
  const clientIP = req.socket.remoteAddress;

  // Stocker les informations de connexion du client
  clients.set(clientIP, ws);

  console.log(`Nouvelle connexion depuis ${clientIP}`);

  // Gérer les messages reçus du client
  ws.on("message", (message) => {
    console.log(`Reçu un message de ${clientIP}: ${message}`);

    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case "connectionResponse":
          // Gérer la réponse du destinataire à la demande de connexion
          handleConnectionResponse(data.ID, data.accepted);
          break;
        case "screenShareRequest":
          // Gérer la demande de partage d'écran
          handleScreenShareRequest(clientIP, data.ID);
          break;
        // Ajoutez d'autres types de messages si nécessaire
        default:
          console.error(`Type de message inconnu: ${data.type}`);
      }
    } catch (error) {
      console.error(`Erreur lors du traitement du message: ${error}`);
    }
  });

  // Gérer la déconnexion du client
  ws.on("close", () => {
    console.log(`Client ${clientIP} déconnecté`);
    clients.delete(clientIP);
  });
});

// Fonction pour gérer la réponse du destinataire à la demande de connexion
function handleConnectionResponse(ID, accepted) {
  // Rechercher les informations de connexion de l'initiateur dans la base de données
  getConnectionInitiatorInfo(ID)
    .then((initiatorInfo) => {
      if (initiatorInfo) {
        const { initiateur_ip, destinataire_ip } = initiatorInfo;

        // Envoyer la réponse de connexion à l'adresse IP de l'initiateur via WebSocket
        sendConnectionResponse(initiateur_ip, accepted)
          .then(() => {
            // Mettre à jour l'état de la connexion dans la base de données
            updateConnectionStatus(ID, accepted)
              .then(() => {
                console.log(
                  `Connexion ${
                    accepted ? "acceptée" : "refusée"
                  } pour l'ID ${ID}`
                );
              })
              .catch((error) => {
                console.error(
                  "Erreur lors de la mise à jour de l'état de la connexion :",
                  error
                );
              });
          })
          .catch((error) => {
            console.error(
              "Erreur lors de l'envoi de la réponse de connexion :",
              error
            );
          });

        // Si la connexion est acceptée, démarrer le partage d'écran
        if (accepted) {
          startScreenSharing(destinataire_ip, initiateur_ip);
        }
      } else {
        console.error(
          `Impossible de trouver les informations de connexion pour l'ID ${ID}`
        );
      }
    })
    .catch((error) => {
      console.error(
        "Erreur lors de la recherche des informations de connexion :",
        error
      );
    });
}

// Fonction pour envoyer la réponse de connexion à l'adresse IP de l'initiateur
function sendConnectionResponse(initiatorIP, accepted) {
  return new Promise((resolve, reject) => {
    // Rechercher la connexion WebSocket de l'initiateur
    const initiateur = clients.get(initiatorIP);

    if (initiateur) {
      // Envoyer la réponse de connexion à l'initiateur via WebSocket
      initiateur.send(JSON.stringify({ type: "connectionResponse", accepted }));
      resolve();
    } else {
      reject(
        new Error(
          `Impossible d'envoyer la réponse de connexion, l'initiateur à l'adresse IP ${initiatorIP} n'est pas connecté.`
        )
      );
    }
  });
}

// Fonction pour mettre à jour l'état de la connexion dans la base de données
function updateConnectionStatus(ID, accepted) {
  return new Promise((resolve, reject) => {
    const query = "UPDATE Connexion SET acceptee = ? WHERE initiateur_id = ?";
    connection.query(query, [accepted, ID], (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Fonction pour récupérer les informations de connexion de l'initiateur
function getConnectionInitiatorInfo(ID) {
  return new Promise((resolve, reject) => {
    const query =
      "SELECT initiateur_ip, destinataire_ip FROM Connexion WHERE initiateur_id = ?";
    connection.query(query, [ID], (err, result) => {
      if (err) {
        reject(err);
      } else {
        if (result.length > 0) {
          resolve(result[0]);
        } else {
          resolve(null);
        }
      }
    });
  });
}

// Fonction pour démarrer le partage d'écran
function startScreenSharing(destinaireIP, initiatorIP) {
  // Implémentez la logique pour capturer l'écran du destinataire et l'envoyer à l'initiateur via WebSocket
  // Cela peut impliquer l'utilisation de bibliothèques comme 'node-screenshot-desktop' ou 'desktop-capturer' (pour Electron)
  console.log(
    `Démarrage du partage d'écran entre ${destinaireIP}: et ${initiatorIP}`
  );
}

// Démarrer le serveur
app.listen(port, () => {
  console.log(`Serveur démarré sur le port ${port}`);
});
