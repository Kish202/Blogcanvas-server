import mongoose, { Schema } from "mongoose";

const inkMarkSchema = mongoose.Schema({
    blog: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "blogs"
    },
    user: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "users"
    },
    type: {
        type: String,
        enum: ["ink", "coffee", "spark", "flower", "scribble"],
        required: true
    },
    x: {
        type: Number,
        required: true,
        min: 2,
        max: 98
    },
    y: {
        type: Number,
        required: true,
        min: 2,
        max: 98
    },
    rotate: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

inkMarkSchema.index({ blog: 1, user: 1, type: 1 }, { unique: true });
inkMarkSchema.index({ blog: 1, createdAt: -1 });

export default mongoose.model("inkmarks", inkMarkSchema);
