const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion } = require("mongodb");
const { ObjectId } = require("mongodb");
const { createRemoteJWKSet } = require("jose-cjs");
const { jwtVerify } = require("jose");

dotenv.config();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const JWKS  = createRemoteJWKSet(
      new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
    )
console.log(JWKS);
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const logger = (req, res, next) => {
  console.log(`${req.method} | ${req.url}`);
  next();
};

// const verifyToken = async (req, res, next) => {
//   console.log(req.headers, "verifyToken");

//   next();
// };
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify the JWT using the JWKS set
    const { payload } = await jwtVerify(token, JWKS);
    
    // Attach user info from the token payload to the request
    req.user = payload; 
    
    next();
  } catch (err) {
    console.error("JWT Verification failed:", err.message);
    return res.status(403).send({ message: "Forbidden: Invalid or expired token" });
  }
};



async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    //await client.db("admin").command({ ping: 1 });

    const db = client.db("MediqueueDB");
    const tutorsCollection = db.collection("tutors");

    // app.get("/tutors", async(req, res) =>{
    //   const cursor =tutorsCollection.find();
    //   const result =await cursor.toArray();
    //   res.send(result);
    // })

    app.get("/tutors", async (req, res) => {
      try {
        const { search, startDate, endDate, sort, limit } = req.query;

        let query = {};

        // ================= SEARCH (NAME) =================
        if (search) {
          query.name = {
            $regex: search,
            $options: "i", // case-insensitive
          };
        }

        // ================= DATE FILTER =================
        if (startDate || endDate) {
          query.createdAt = {};

          if (startDate) {
            query.createdAt.$gte = new Date(startDate);
          }

          if (endDate) {
            query.createdAt.$lte = new Date(endDate);
          }
        }

        // ================= SORT =================
        let sortOption = {};

        if (sort === "low-to-high") {
          sortOption.price = 1;
        } else if (sort === "high-to-low") {
          sortOption.price = -1;
        }

        // ================= QUERY =================
        let cursor = tutorsCollection.find(query).sort(sortOption);

        // LIMIT (for homepage 6 tutors)
        if (limit) {
          cursor = cursor.limit(parseInt(limit));
        }

        const result = await cursor.toArray();
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
      }
    });

    app.get(
      "/tutors/:tutorId",
      logger,
      verifyToken,
      //console.log(req.user, "req");

      // (req,res, next) =>{
      //   console.log(req.params, "2nd");
      //   next();
      // },

      async (req, res) => {
        const { tutorId } = req.params;

        const query = { _id: new ObjectId(tutorId) };

        const result = await tutorsCollection.findOne(query);

        res.send(result);
      },
    );

    app.get("/featured-tutors", async (req, res) => {
      const cursor = tutorsCollection.find().limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    // add tutor

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
