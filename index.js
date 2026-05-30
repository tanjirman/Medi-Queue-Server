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
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// JWT token
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);
// console.log(JWKS);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
   
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
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
    const bookingsCollection = db.collection("bookings");

    const usersCollection = db.collection("users");

    app.get("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne({
          email,
        });

        res.send(user || {});
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    app.patch("/users/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const result = await usersCollection.updateOne(
          { email },
          {
            $set: req.body,
          },
          {
            upsert: true,
          },
        );

        res.send(result);
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // get tutors data for tutors page
    app.get("/tutors", async (req, res) => {
      try {
        const { search, startDate, endDate, sort, limit, email } = req.query;

        let query = {};

        // ONLY LOGGED USER TUTORS
        if (email) {
          query.creatorEmail = email;
        }

        // SEARCH
        if (search) {
          query.name = {
            $regex: search,
            $options: "i",
          };
        }

        // DATE FILTER
        if (startDate || endDate) {
          query.createdAt = {};

          if (startDate) {
            query.createdAt.$gte = new Date(startDate);
          }

          if (endDate) {
            query.createdAt.$lte = new Date(endDate);
          }
        }

        // SORT
        let sortOption = {};

        if (sort === "low-to-high") {
          sortOption.price = 1;
        } else if (sort === "high-to-low") {
          sortOption.price = -1;
        }

        let cursor = tutorsCollection.find(query).sort(sortOption);

        if (limit) {
          cursor = cursor.limit(parseInt(limit));
        }

        const result = await cursor.toArray();

        res.send(result);
      } catch (err) {
        console.log(err);

        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // tutor-details
    app.get(
      "/tutors/:tutorId",
      verifyToken,

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

    app.post("/bookings", async (req, res) => {
      try {
        const booking = req.body;

        const tutorId = booking.tutorId;

        // 1. check tutor
        const tutor = await tutorsCollection.findOne({
          _id: new ObjectId(tutorId),
        });

        if (!tutor) {
          return res.status(404).send({
            success: false,
            message: "Tutor not found",
          });
        }

        // 2. check slots
        if (tutor.totalSlot <= 0) {
          return res.status(400).send({
            success: false,
            message: "No available slots",
          });
        }

        // 3. insert booking
        booking.createdAt = new Date();
        booking.status = "Booked";

        const result = await bookingsCollection.insertOne(booking);

        // 4. decrease slot
        await tutorsCollection.updateOne(
          { _id: new ObjectId(tutorId) },
          { $inc: { totalSlot: -1 } },
        );

        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // get my-booking page Api
    app.get("/bookings", verifyToken, async (req, res) => {
      try {
        const email = req.query.email;

        const result = await bookingsCollection
          .find({ studentEmail: email })
          .toArray();

        res.send(result);
      } catch (err) {
        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // cancel booking
    app.patch("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;

        //  Find booking first
        const booking = await bookingsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!booking) {
          return res.status(404).send({
            success: false,
            message: "Booking not found",
          });
        }

        //  Update booking status
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "Cancelled",
            },
          },
        );

        await tutorsCollection.updateOne(
          { _id: new ObjectId(booking.tutorId) },
          {
            $inc: { totalSlot: 1 },
          },
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
          message: "Booking cancelled and slot restored",
        });
      } catch (err) {
        console.log(err);

        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // add tutor
    app.post("/tutors", verifyToken, async (req, res) => {
      try {
        const tutorData = req.body;

        tutorData.createdAt = new Date();

        const result = await tutorsCollection.insertOne(tutorData);

        res.status(201).send({
          success: true,
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.log(err);

        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // tutor update

    app.patch("/tutors/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid tutor id",
          });
        }

        const tutor = await tutorsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tutor) {
          return res.status(404).send({
            success: false,
            message: "Tutor not found",
          });
        }

        const updateData = req.body;

        delete updateData._id;

        if (updateData.price) {
          updateData.price = Number(updateData.price);
        }

        if (updateData.totalSlot) {
          updateData.totalSlot = Number(updateData.totalSlot);
        }

        const result = await tutorsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData },
        );

        res.send({
          success: true,
          modifiedCount: result.modifiedCount,
        });
      } catch (err) {
        console.log(err);

        res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

    // DELETE TUTOR

    app.delete("/tutors/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid tutor id",
          });
        }

        const tutor = await tutorsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tutor) {
          return res.status(404).send({
            success: false,
            message: "Tutor not found",
          });
        }

        await bookingsCollection.deleteMany({
          tutorId: id,
        });

        const result = await tutorsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        return res.send({
          success: true,
          deletedCount: result.deletedCount,
        });
      } catch (err) {
        console.log(err);

        return res.status(500).send({
          success: false,
          message: err.message,
        });
      }
    });

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
  res.send("Mediqueue Server Running");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
