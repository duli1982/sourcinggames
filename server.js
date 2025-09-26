require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- DATABASE HELPERS ---
const DB_PATH = path.join(__dirname, 'db.json');

const readDb = () => {
    try {
        if (fs.existsSync(DB_PATH)) {
            const dbRaw = fs.readFileSync(DB_PATH);
            return JSON.parse(dbRaw);
        }
        // If db.json doesn't exist, return a default structure
        return { users: [], games: [], submissions: [] };
    } catch (error) {
        console.error("Error reading or parsing db.json:", error);
        return { users: [], games: [], submissions: [] };
    }
};

const writeDb = (data) => {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error writing to db.json:", error);
    }
};

// --- GEMINI API SETUP ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function callGemini(prompt) {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
        console.error("Gemini API key is missing or is a placeholder.");
        return "AI Coach is not configured. Please add a valid API key on the server.";
    }
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        throw new Error("Failed to get response from AI Coach.");
    }
}

const getGamePrompt = (game, submission) => {
    // This structure creates a specific, detailed prompt for the AI based on which game is being played.
    // This can be expanded with more game types.
    return `
        You are an expert AI Sourcing Coach for recruiters. A participant has submitted an answer for the game: "${game.title}".
        The game description was: "${game.description}"
        The user's task was: "${game.task}"

        Submission: "${submission}"

        Your task is to:
        1.  Analyze the submission based on the game's context.
        2.  Provide a score out of 100. The score MUST be on its own line like this: SCORE: [number].
        3.  Give 2-3 concrete, actionable tips for improvement in a bulleted or numbered list.
        4.  Provide an improved version of their submission if applicable.
        5.  Format your response in simple markdown.
    `;
};


// --- API ROUTES ---

// Login or Register a user
app.post('/api/login', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ message: 'Name is required' });
    }

    const db = readDb();
    let user = db.users.find(u => u.name.toLowerCase() === name.toLowerCase());

    if (!user) {
        user = {
            id: db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1,
            name: name,
            score: 0
        };
        db.users.push(user);
        writeDb(db);
    }
    res.json(user);
});

// Get the current leaderboard
app.get('/api/leaderboard', (req, res) => {
    const db = readDb();
    const sortedLeaderboard = [...db.users].sort((a, b) => b.score - a.score);
    res.json(sortedLeaderboard);
});

// Get the current game
app.get('/api/game/current', (req, res) => {
    const db = readDb();
    const now = new Date();

    // Logic to find the game for the current week (Friday to next Friday)
    const currentGame = db.games.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate))
                                .find(game => new Date(game.releaseDate) <= now);

    if (!currentGame) {
        return res.status(404).json({ message: 'No active game found.' });
    }
    res.json(currentGame);
});

// Handle game submission
app.post('/api/submit/:gameId', async (req, res) => {
    const { gameId } = req.params;
    const { userId, submission } = req.body;

    if (!userId || !submission) {
        return res.status(400).json({ message: 'User ID and submission are required.' });
    }

    const db = readDb();
    const game = db.games.find(g => g.id === gameId);
    const user = db.users.find(u => u.id === userId);

    if (!game || !user) {
        return res.status(404).json({ message: 'Game or user not found.' });
    }

    try {
        const prompt = getGamePrompt(game, submission);
        const feedbackText = await callGemini(prompt);

        const scoreMatch = feedbackText.match(/SCORE: (\d+)/);
        const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

        user.score += score;

        db.submissions.push({
            submissionId: db.submissions.length + 1,
            userId: user.id,
            gameId: game.id,
            submission: submission,
            score: score,
            timestamp: new Date().toISOString()
        });

        writeDb(db);

        res.json({
            feedback: feedbackText,
            newScore: user.score
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Handle serving the main page
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});