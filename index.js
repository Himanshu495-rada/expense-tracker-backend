const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { PrismClient, PrismaClient } = require("@prisma/client");

require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const prisma = new PrismaClient();

app.get("/", (req, res) => {
  res.send("Welcome to Expense tracker app backend");
});

app.post("/signup", async (req, res) => {
  const { username, password } = req.body;

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const user = await prisma.user.create({
      data: {
        username: username,
        password: hashedPassword,
      },
    });
    res.status(200).json({ message: "Registration successful" });
  } catch (error) {
    console.log("Error hashing password: " + error);
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
  } else {
    const userId = user.id;
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (passwordMatch) {
      const token = jwt.sign({ userId, username }, process.env.JWT_KEY, {
        expiresIn: "10h",
      });

      res.status(200).json({ token, userId });
    } else {
      res.status(401).json({ message: "Wrong password" });
    }
  }
});

function authenticateToken(req, res, next) {
  const token = req.header("Authorization");
  if (!token) {
    return res
      .status(401)
      .json({ message: "Authentication failed: Token missing" });
  }

  jwt.verify(token, process.env.JWT_KEY, (err, user) => {
    if (err) {
      console.error("JWT verification error: ", error);
      return res.status(403).json({ message: "Forbidden: Token invalid" });
    }
    req.user = user;
    next();
  });
}

app.get("/authenticate", authenticateToken, (req, res) => {
  res.json({ message: "Authenticated", user: req.user });
});

app.post("/logout", authenticateToken, (req, res) => {
  res.json({ message: "Logout successful" });
});

// Get data for chart and dashboard
app.get("/dashboard/data", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Get all entries for the current month
    const currentMonthEntries = await prisma.entry.findMany({
      where: {
        userId,
        date: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
      orderBy: {
        category: "asc",
      },
    });

    // Separate entries into income and expense arrays
    const currentMonthIncome = currentMonthEntries.filter(
      (entry) => entry.category === "income"
    );
    const currentMonthExpenses = currentMonthEntries.filter(
      (entry) => entry.category === "expense"
    );

    // Calculate total income for the current month
    const currentMonthIncomeTotal = currentMonthIncome.reduce(
      (total, entry) => total + entry.amount,
      0
    );

    // Calculate total expense for the current month
    const currentMonthExpenseTotal = currentMonthExpenses.reduce(
      (total, entry) => total + entry.amount,
      0
    );

    res.json({
      currentMonthIncomeTotal,
      currentMonthExpenseTotal,
      currentMonthExpenses,
      currentMonthIncome,
      currentMonthEntries,
    });
  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Get Recent Entries for Dashboard
app.get("/dashboard/recent-entries", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    // Get the 3 most recent entries
    const recentEntries = await prisma.entry.findMany({
      where: {
        userId,
      },
      orderBy: {
        date: "desc",
      },
      take: 3,
    });

    res.json(recentEntries);
  } catch (error) {
    console.error("Error fetching recent entries:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.get("/entries/:year/:month", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { year, month } = req.params;

  try {
    // Get entries for the specified month and year
    const entries = await prisma.entry.findMany({
      where: {
        userId,
        date: {
          gte: new Date(year, month - 1, 1), // Month is 0-indexed in JavaScript Date
          lt: new Date(year, month, 1),
        },
      },
    });

    res.json(entries);
  } catch (error) {
    console.error("Error fetching entries for the specified month:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Create Entry (both income and expense)
app.post("/entries", authenticateToken, async (req, res) => {
  let { amount, description, date, category } = req.body;
  //convert string to number and date to IsoDate
  amount = parseFloat(amount);
  date = new Date(date).toISOString();
  const userId = req.user.userId;

  try {
    const entry = await prisma.entry.create({
      data: {
        amount,
        description,
        date,
        category,
        userId,
      },
    });

    res.status(201).json(entry);
  } catch (error) {
    console.error("Error creating entry:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Get All Entries
app.get("/entries", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const entries = await prisma.entry.findMany({
      where: {
        userId,
      },
    });

    res.json(entries);
  } catch (error) {
    console.error("Error getting entries:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Get Single Entry
app.get("/entries/:id", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const entryId = parseInt(req.params.id, 10);

  try {
    const entry = await prisma.entry.findUnique({
      where: {
        id: entryId,
        userId,
      },
    });

    if (!entry) {
      res.status(404).send("Entry not found");
      return;
    }

    res.json(entry);
  } catch (error) {
    console.error("Error getting entry:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Update Entry
app.put("/entries/:id", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const entryId = parseInt(req.params.id, 10);
  const { amount, description, date, category } = req.body;

  try {
    const updatedEntry = await prisma.entry.update({
      where: {
        id: entryId,
        userId,
      },
      data: {
        amount,
        description,
        date,
        category,
      },
    });

    res.json(updatedEntry);
  } catch (error) {
    console.error("Error updating entry:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Delete Entry
app.delete("/entries/:id", authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const entryId = parseInt(req.params.id, 10);

  try {
    await prisma.entry.delete({
      where: {
        id: entryId,
        userId,
      },
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting entry:", error);
    res.status(500).send("Internal Server Error");
  }
});

const PORT = 5252;
app.listen(PORT, () => {
  console.log("Server is running on port: " + PORT);
});
